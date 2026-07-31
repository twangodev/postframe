struct Transform {
    scale: vec2<f32>,
    offset: vec2<f32>,
};

@group(0) @binding(0) var image_texture: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
@group(0) @binding(2) var<uniform> transform: Transform;

struct ImageVertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_image(@builtin(vertex_index) index: u32) -> ImageVertex {
    let uv = vec2<f32>(f32(index & 1u), f32(index >> 1u));
    let ndc = (uv * 2.0 - 1.0) * transform.scale + transform.offset;
    return ImageVertex(vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0), uv);
}

@fragment
fn fs_image(vertex: ImageVertex) -> @location(0) vec4<f32> {
    return textureSample(image_texture, image_sampler, vertex.uv);
}

@group(0) @binding(0) var ui_texture: texture_2d<f32>;
@group(0) @binding(1) var ui_sampler: sampler;

struct BlitVertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_blit(@builtin(vertex_index) index: u32) -> BlitVertex {
    let uv = vec2<f32>(f32(index & 1u), f32(index >> 1u));
    return BlitVertex(vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}

@fragment
fn fs_blit(vertex: BlitVertex) -> @location(0) vec4<f32> {
    return textureSample(ui_texture, ui_sampler, vertex.uv);
}
