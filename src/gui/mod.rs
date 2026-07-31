mod preview;
mod surface;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use postframe::Merged;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

use preview::Preview;
use surface::Gpu;

pub fn open(pairs: Vec<(PathBuf, Option<PathBuf>)>) -> anyhow::Result<()> {
    let content = if pairs.is_empty() {
        Content::Empty
    } else {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let borrowed: Vec<_> = pairs
                .iter()
                .map(|(raf, jpeg)| (raf.as_path(), jpeg.as_deref()))
                .collect();
            let _ = sender.send(postframe::merge_preview(&borrowed));
        });
        Content::Merging(receiver)
    };

    let event_loop = EventLoop::new()?;
    let mut app = App::new(content);
    event_loop.run_app(&mut app)?;
    app.failure.map_or(Ok(()), Err)
}

enum Content {
    Empty,
    Merging(Receiver<postframe::Result<Merged>>),
    Ready {
        merged: Box<Merged>,
        preview: Preview,
    },
    Failed(String),
}

struct Params {
    ev: f32,
    tone: bool,
}

struct App {
    content: Content,
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

const HOME_VIEW: View = View {
    zoom: 1.0,
    pan: (0.0, 0.0),
};

impl App {
    fn new(content: Content) -> Self {
        Self {
            content,
            params: Params {
                ev: 0.0,
                tone: false,
            },
            dirty: true,
            view: HOME_VIEW,
            gpu: None,
            egui: None,
            window: None,
            cursor: (0.0, 0.0),
            dragging: false,
            failure: None,
        }
    }

    fn poll_merge(&mut self) {
        let Content::Merging(receiver) = &self.content else {
            return;
        };
        let Some(gpu) = &mut self.gpu else {
            return;
        };
        match receiver.try_recv() {
            Ok(Ok(merged)) => {
                let preview = Preview::new(&merged);
                gpu.set_image(preview.width as u32, preview.height as u32);
                self.dirty = true;
                self.content = Content::Ready {
                    merged: Box::new(merged),
                    preview,
                };
            }
            Ok(Err(error)) => self.content = Content::Failed(error.to_string()),
            Err(_) => {}
        }
    }

    fn redraw(&mut self) -> anyhow::Result<()> {
        self.poll_merge();
        let (Some(gpu), Some(egui), Some(window)) = (&mut self.gpu, &mut self.egui, &self.window)
        else {
            return Ok(());
        };

        if self.dirty {
            if let Content::Ready { merged, preview } = &self.content {
                let pixels = preview.pixels(merged, self.params.ev, self.params.tone, gpu.hdr);
                gpu.upload_image(&pixels);
            }
            self.dirty = false;
        }

        let surface_label = gpu.surface_label();
        let hdr_label = gpu.hdr_label().to_string();
        let input = egui.state.take_egui_input(window);
        let output = egui.context.run_ui(input, |root| {
            egui::Panel::right("controls").show(root, |ui| {
                ui.heading("postframe");
                ui.add_space(8.0);
                match &self.content {
                    Content::Empty => {
                        ui.label("no bracket loaded");
                        ui.label("start with: postframe <RAF files>");
                    }
                    Content::Merging(_) => {
                        ui.horizontal(|ui| {
                            ui.spinner();
                            ui.label("merging bracket…");
                        });
                    }
                    Content::Failed(error) => {
                        ui.colored_label(egui::Color32::LIGHT_RED, error);
                    }
                    Content::Ready { .. } => {
                        let ev =
                            ui.add(egui::Slider::new(&mut self.params.ev, -4.0..=4.0).text("EV"));
                        let tone = ui.checkbox(&mut self.params.tone, "tone-map highlights");
                        if ev.changed() || tone.changed() {
                            self.dirty = true;
                        }
                        ui.add_space(8.0);
                        if ui.button("reset view").clicked() {
                            self.view = HOME_VIEW;
                        }
                    }
                }
                ui.add_space(12.0);
                ui.label(format!("surface  {surface_label}"));
                ui.label(format!("display  {hdr_label}"));
            });
        });
        egui.state
            .handle_platform_output(window, output.platform_output);
        if self.dirty || matches!(self.content, Content::Merging(_)) {
            window.request_redraw();
        }

        let clipped = egui
            .context
            .tessellate(output.shapes, output.pixels_per_point);
        let transform = match &self.content {
            Content::Ready { preview, .. } => transform(
                (gpu.width() as f32, gpu.height() as f32),
                (preview.width as f32, preview.height as f32),
                self.view,
            ),
            _ => [0.0; 4],
        };
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
            let gpu = Gpu::new(window.clone())?;
            let context = egui::Context::default();
            let state = egui_winit::State::new(
                context.clone(),
                egui::ViewportId::ROOT,
                &window,
                Some(window.scale_factor() as f32),
                None,
                None,
            );
            window.request_redraw();
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
