mod preview;
mod surface;

use std::sync::Arc;

use anyhow::Context as _;
use postframe::Merged;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

use preview::Preview;
use surface::Gpu;

pub fn run(merged: Merged) -> anyhow::Result<()> {
    let event_loop = EventLoop::new()?;
    let mut app = App::new(merged);
    event_loop.run_app(&mut app)?;
    app.failure.map_or(Ok(()), Err)
}

struct Params {
    ev: f32,
    tone: bool,
}

struct App {
    merged: Merged,
    preview: Preview,
    params: Params,
    dirty: bool,
    view: View,
    gpu: Option<Gpu>,
    egui: Option<EguiGlue>,
    window: Option<Arc<Window>>,
    cursor: (f32, f32),
    dragging: bool,
    failure: Option<anyhow::Error>,
}

struct EguiGlue {
    context: egui::Context,
    state: egui_winit::State,
}

#[derive(Clone, Copy)]
struct View {
    zoom: f32,
    pan: (f32, f32),
}

impl App {
    fn new(merged: Merged) -> Self {
        let preview = Preview::new(&merged);
        Self {
            merged,
            preview,
            params: Params {
                ev: 0.0,
                tone: false,
            },
            dirty: true,
            view: View {
                zoom: 1.0,
                pan: (0.0, 0.0),
            },
            gpu: None,
            egui: None,
            window: None,
            cursor: (0.0, 0.0),
            dragging: false,
            failure: None,
        }
    }

    fn redraw(&mut self) -> anyhow::Result<()> {
        let (Some(gpu), Some(egui), Some(window)) = (&mut self.gpu, &mut self.egui, &self.window)
        else {
            return Ok(());
        };

        if self.dirty {
            let pixels =
                self.preview
                    .pixels(&self.merged, self.params.ev, self.params.tone, gpu.hdr);
            gpu.upload_image(&pixels);
            self.dirty = false;
        }

        let surface_label = gpu.surface_label();
        let hdr_label = gpu.hdr_label().to_string();
        let input = egui.state.take_egui_input(window);
        let output = egui.context.run_ui(input, |root| {
            egui::Panel::right("controls").show(root, |ui| {
                ui.heading("postframe");
                ui.add_space(8.0);
                let ev = ui.add(egui::Slider::new(&mut self.params.ev, -4.0..=4.0).text("EV"));
                let tone = ui.checkbox(&mut self.params.tone, "tone-map highlights");
                if ev.changed() || tone.changed() {
                    self.dirty = true;
                }
                ui.add_space(8.0);
                if ui.button("reset view").clicked() {
                    self.view = View {
                        zoom: 1.0,
                        pan: (0.0, 0.0),
                    };
                }
                ui.add_space(12.0);
                ui.label(format!("surface  {surface_label}"));
                ui.label(format!("display  {hdr_label}"));
            });
        });
        egui.state
            .handle_platform_output(window, output.platform_output);
        if self.dirty {
            window.request_redraw();
        }

        let clipped = egui
            .context
            .tessellate(output.shapes, output.pixels_per_point);
        let transform = transform(
            (gpu.width() as f32, gpu.height() as f32),
            (self.preview.width as f32, self.preview.height as f32),
            self.view,
        );
        gpu.render(
            &clipped,
            output.textures_delta,
            output.pixels_per_point,
            transform,
        )?;
        Ok(())
    }
}

fn transform((win_w, win_h): (f32, f32), (img_w, img_h): (f32, f32), view: View) -> [f32; 4] {
    let fit = (win_w / img_w).min(win_h / img_h);
    let scale = fit * view.zoom;
    [
        img_w * scale / win_w,
        img_h * scale / win_h,
        2.0 * view.pan.0 / win_w,
        2.0 * view.pan.1 / win_h,
    ]
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let built = (|| -> anyhow::Result<()> {
            let window = Arc::new(
                event_loop.create_window(Window::default_attributes().with_title("postframe"))?,
            );
            let gpu = Gpu::new(
                window.clone(),
                self.preview.width as u32,
                self.preview.height as u32,
            )?;
            let context = egui::Context::default();
            let state = egui_winit::State::new(
                context.clone(),
                egui::ViewportId::ROOT,
                &window,
                Some(window.scale_factor() as f32),
                None,
                None,
            );
            self.window = Some(window);
            self.gpu = Some(gpu);
            self.egui = Some(EguiGlue { context, state });
            Ok(())
        })();
        if let Err(error) = built {
            self.failure = Some(error.context("gui startup failed"));
            event_loop.exit();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        let Some(window) = self.window.clone() else {
            return;
        };
        let consumed = self
            .egui
            .as_mut()
            .map(|egui| {
                let response = egui.state.on_window_event(&window, &event);
                if response.repaint {
                    window.request_redraw();
                }
                response.consumed
            })
            .unwrap_or(false);

        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = &mut self.gpu {
                    gpu.resize(size.width, size.height);
                }
                window.request_redraw();
            }
            WindowEvent::RedrawRequested => {
                if let Err(error) = self.redraw() {
                    self.failure = Some(error);
                    event_loop.exit();
                }
            }
            WindowEvent::MouseInput { state, button, .. } if !consumed => {
                if button == MouseButton::Left {
                    self.dragging = state == ElementState::Pressed;
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let (x, y) = (position.x as f32, position.y as f32);
                if self.dragging && !consumed {
                    self.view.pan.0 += x - self.cursor.0;
                    self.view.pan.1 += y - self.cursor.1;
                    window.request_redraw();
                }
                self.cursor = (x, y);
            }
            WindowEvent::MouseWheel { delta, .. } if !consumed => {
                let steps = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 60.0,
                };
                let factor = 1.15f32.powf(steps);
                let (win_w, win_h) = self
                    .gpu
                    .as_ref()
                    .map(|g| (g.width() as f32, g.height() as f32))
                    .unwrap_or((1.0, 1.0));
                let centre = (win_w / 2.0 + self.view.pan.0, win_h / 2.0 + self.view.pan.1);
                self.view.pan.0 += (centre.0 - self.cursor.0) * (factor - 1.0);
                self.view.pan.1 += (centre.1 - self.cursor.1) * (factor - 1.0);
                self.view.zoom = (self.view.zoom * factor).clamp(0.05, 64.0);
                window.request_redraw();
            }
            _ => {}
        }
    }
}

pub fn open(pairs: &[(&std::path::Path, Option<&std::path::Path>)]) -> anyhow::Result<()> {
    let merged = postframe::merge_preview(pairs).context("merging bracket")?;
    run(merged)
}
