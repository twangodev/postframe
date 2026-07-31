use std::sync::Arc;

use anyhow::Context as _;
use winit::window::Window;

pub struct Gpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    shader: wgpu::ShaderModule,
    pub hdr: bool,
    hdr_info: String,
    image: Option<ImagePass>,
    ui: UiPass,
    egui_renderer: egui_wgpu::Renderer,
}

struct ImagePass {
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    texture: wgpu::Texture,
    uniform: wgpu::Buffer,
    width: u32,
    height: u32,
}

struct UiPass {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
}

const UI_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

impl Gpu {
    pub fn new(window: Arc<Window>) -> anyhow::Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(
            wgpu::InstanceDescriptor::new_with_display_handle_from_env(Box::new(window.clone())),
        );
        let surface = instance.create_surface(window)?;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        }))
        .context("no compatible gpu adapter")?;
        let (device, queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("postframe"),
                required_limits: adapter.limits(),
                ..Default::default()
            }))?;

        let capabilities = surface.get_capabilities(&adapter);
        let (format, color_space, hdr) = choose(&capabilities);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            desired_maximum_frame_latency: 2,
            alpha_mode: capabilities.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let hdr_info = format!("{:?}", surface.display_hdr_info(&adapter));

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("postframe-gui"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let ui = UiPass::new(&device, &shader, format, config.width, config.height);
        let egui_renderer =
            egui_wgpu::Renderer::new(&device, UI_FORMAT, egui_wgpu::RendererOptions::default());

        Ok(Self {
            surface,
            device,
            queue,
            config,
            shader,
            hdr,
            hdr_info,
            image: None,
            ui,
            egui_renderer,
        })
    }

    pub fn set_image(&mut self, width: u32, height: u32) {
        self.image = Some(ImagePass::new(
            &self.device,
            &self.shader,
            self.config.format,
            width,
            height,
        ));
    }

    pub fn width(&self) -> u32 {
        self.config.width
    }

    pub fn height(&self) -> u32 {
        self.config.height
    }

    pub fn surface_label(&self) -> String {
        format!("{:?} / {:?}", self.config.format, self.config.color_space)
    }

    pub fn hdr_label(&self) -> &str {
        &self.hdr_info
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.device, &self.config);
        self.ui
            .recreate_target(&self.device, self.config.width, self.config.height);
    }

    pub fn upload_image(&mut self, pixels: &[u16]) {
        let Some(image) = &self.image else {
            return;
        };
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &image.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(pixels),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(image.width * 8),
                rows_per_image: Some(image.height),
            },
            wgpu::Extent3d {
                width: image.width,
                height: image.height,
                depth_or_array_layers: 1,
            },
        );
    }

    pub fn render(
        &mut self,
        clipped: &[egui::ClippedPrimitive],
        textures: egui::TexturesDelta,
        pixels_per_point: f32,
        transform: [f32; 4],
    ) -> anyhow::Result<()> {
        if let Some(image) = &self.image {
            self.queue
                .write_buffer(&image.uniform, 0, bytemuck::cast_slice(&transform));
        }

        use wgpu::CurrentSurfaceTexture::{Lost, Occluded, Outdated, Suboptimal, Success, Timeout};
        let frame = match self.surface.get_current_texture() {
            Success(frame) | Suboptimal(frame) => frame,
            Outdated | Lost => {
                self.surface.configure(&self.device, &self.config);
                match self.surface.get_current_texture() {
                    Success(frame) | Suboptimal(frame) => frame,
                    other => anyhow::bail!("surface unavailable: {other:?}"),
                }
            }
            Timeout | Occluded => return Ok(()),
            other => anyhow::bail!("surface unavailable: {other:?}"),
        };
        let target = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        for (id, deltas) in &textures.set {
            for delta in deltas {
                self.egui_renderer
                    .update_texture(&self.device, &self.queue, *id, delta);
            }
        }
        let screen = egui_wgpu::ScreenDescriptor {
            size_in_pixels: [self.config.width, self.config.height],
            pixels_per_point,
        };
        self.egui_renderer.update_buffers(
            &self.device,
            &self.queue,
            &mut encoder,
            clipped,
            &screen,
        );

        {
            let view = self
                .ui
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut pass = encoder
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("egui"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                })
                .forget_lifetime();
            self.egui_renderer.render(&mut pass, clipped, &screen);
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("composite"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.015,
                            g: 0.015,
                            b: 0.015,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            if let Some(image) = &self.image {
                pass.set_pipeline(&image.pipeline);
                pass.set_bind_group(0, &image.bind_group, &[]);
                pass.draw(0..4, 0..1);
            }
            pass.set_pipeline(&self.ui.pipeline);
            pass.set_bind_group(0, &self.ui.bind_group, &[]);
            pass.draw(0..4, 0..1);
        }

        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);

        for id in &textures.free {
            self.egui_renderer.free_texture(id);
        }
        Ok(())
    }
}

fn choose(
    capabilities: &wgpu::SurfaceCapabilities,
) -> (wgpu::TextureFormat, wgpu::SurfaceColorSpace, bool) {
    let scrgb = capabilities.format_capabilities.iter().find(|fc| {
        fc.format == wgpu::TextureFormat::Rgba16Float
            && fc
                .color_spaces
                .contains(wgpu::SurfaceColorSpaces::EXTENDED_SRGB_LINEAR)
    });
    if scrgb.is_some() {
        return (
            wgpu::TextureFormat::Rgba16Float,
            wgpu::SurfaceColorSpace::ExtendedSrgbLinear,
            true,
        );
    }
    let format = capabilities
        .formats
        .iter()
        .copied()
        .find(|f| f.is_srgb())
        .unwrap_or(capabilities.formats[0]);
    (format, wgpu::SurfaceColorSpace::Auto, false)
}

impl ImagePass {
    fn new(
        device: &wgpu::Device,
        shader: &wgpu::ShaderModule,
        target: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("preview"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("transform"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("image"),
            entries: &[
                texture_entry(0),
                sampler_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("image"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(
                        &texture.create_view(&wgpu::TextureViewDescriptor::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let pipeline = pipeline(
            device, shader, target, &layout, "vs_image", "fs_image", false,
        );

        Self {
            pipeline,
            bind_group,
            texture,
            uniform,
            width,
            height,
        }
    }
}

impl UiPass {
    fn new(
        device: &wgpu::Device,
        shader: &wgpu::ShaderModule,
        target: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ui"),
            entries: &[texture_entry(0), sampler_entry(1)],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor::default());
        let pipeline = pipeline(device, shader, target, &layout, "vs_blit", "fs_blit", true);
        let (texture, bind_group) = Self::target(device, &layout, &sampler, width, height);
        Self {
            pipeline,
            layout,
            sampler,
            texture,
            bind_group,
        }
    }

    fn recreate_target(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        let (texture, bind_group) =
            Self::target(device, &self.layout, &self.sampler, width, height);
        self.texture = texture;
        self.bind_group = bind_group;
    }

    fn target(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        width: u32,
        height: u32,
    ) -> (wgpu::Texture, wgpu::BindGroup) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: UI_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ui"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(
                        &texture.create_view(&wgpu::TextureViewDescriptor::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
            ],
        });
        (texture, bind_group)
    }
}

fn pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    target: wgpu::TextureFormat,
    layout: &wgpu::BindGroupLayout,
    vertex: &str,
    fragment: &str,
    blend: bool,
) -> wgpu::RenderPipeline {
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(vertex),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some(vertex),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(fragment),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: target,
                blend: blend.then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    })
}

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}
