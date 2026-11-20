use bytemuck::{Pod, Zeroable};
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

// ============================================================================
// Figma Liquid Glass — Clean Core Engine (Zero Visual Drift, Zero Spaghetti)
// - Embeds the 100% UNMODIFIED original `figma_glass.wgsl` (SHA-256 identical)
// - Pure bit-exact engine optimizations ONLY:
//     1. Frost Pre-Blur dirty caching (0ms blur when backdrop & frost unchanged)
//     2. Single CommandEncoder + 3 separate uniform slots (H, V, Main)
//     3. Cached BindGroups & TextureViews (zero per-frame allocations)
//     4. Zero-copy <video> upload (`copy_external_image_to_texture` on wasm32)
// - Clean compilation on BOTH `wasm32` (`wasm-pack`) AND native `cargo test`
// ============================================================================

#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Glass {
    pub refraction: f32,
    pub depth: f32,
    pub dispersion: f32,
    pub frost: f32,
    pub splay: f32,
    pub light_angle_deg: f32,
    pub light_intensity_pct: f32,
    pub rotation_deg: f32,
    pub fill_rgb: [f32; 3],
    pub fill_opacity_pct: f32,
}

impl Default for Glass {
    fn default() -> Self { Self::regular() }
}

impl Glass {
    pub const fn regular() -> Self {
        Self {
            refraction: 100.0,
            depth: 100.0,
            dispersion: 20.0,
            frost: 4.0,
            splay: 100.0,
            light_angle_deg: -45.0,
            light_intensity_pct: 80.0,
            rotation_deg: 0.0,
            fill_rgb: [1.0, 1.0, 1.0],
            fill_opacity_pct: 0.0,
        }
    }
    pub const fn clear() -> Self { Self { frost: 0.0, ..Self::regular() } }
    pub const fn identity() -> Self {
        Self {
            refraction: 0.0, depth: 0.0, dispersion: 0.0, frost: 0.0,
            light_intensity_pct: 0.0, fill_opacity_pct: 0.0, ..Self::regular()
        }
    }
    pub const fn tint(mut self, rgb: [f32; 3], opacity_pct: f32) -> Self {
        self.fill_rgb = rgb; self.fill_opacity_pct = opacity_pct; self
    }
    pub const fn refraction(mut self, v: f32) -> Self { self.refraction = v; self }
    pub const fn depth(mut self, v: f32) -> Self { self.depth = v; self }
    pub const fn dispersion(mut self, v: f32) -> Self { self.dispersion = v; self }
    pub const fn frost(mut self, v: f32) -> Self { self.frost = v; self }
    pub const fn splay(mut self, v: f32) -> Self { self.splay = v; self }
    pub const fn light_angle(mut self, deg: f32) -> Self { self.light_angle_deg = deg; self }
    pub const fn light_intensity(mut self, pct: f32) -> Self { self.light_intensity_pct = pct; self }
    pub const fn rotation(mut self, deg: f32) -> Self { self.rotation_deg = deg; self }
}

#[derive(Copy, Clone, Debug, PartialEq)]
pub enum GlassShape {
    Capsule,
    Rect { corner_radii: [f32; 4], corner_smoothing: f32 },
    Ellipse,
    Star { corner_radius: f32 },
    Triangle { corner_radius: f32 },
    Hexagon { corner_radius: f32 },
    CustomSdf,
}

impl GlassShape {
    pub const fn capsule() -> Self { Self::Capsule }
    pub const fn rect(r: f32) -> Self { Self::Rect { corner_radii: [r; 4], corner_smoothing: 0.6 } }
    pub const fn circle() -> Self { Self::Ellipse }
    pub const fn star(r: f32) -> Self { Self::Star { corner_radius: r } }
    pub const fn triangle(r: f32) -> Self { Self::Triangle { corner_radius: r } }
    pub const fn hexagon(r: f32) -> Self { Self::Hexagon { corner_radius: r } }

    pub fn resolve(&self, size: [f32; 2]) -> (u32, [f32; 4], f32) {
        match *self {
            Self::Capsule => { let r = size[0].min(size[1]) * 0.5; (0, [r; 4], 0.0) }
            Self::Rect { corner_radii, corner_smoothing } => (0, corner_radii, corner_smoothing),
            Self::Ellipse => (1, [0.0; 4], 0.0),
            Self::Star { corner_radius } => (2, [corner_radius, 0.0, 0.0, 0.0], 0.0),
            Self::Triangle { corner_radius } => (3, [corner_radius, 0.0, 0.0, 0.0], 0.0),
            Self::Hexagon { corner_radius } => (4, [corner_radius, 0.0, 0.0, 0.0], 0.0),
            Self::CustomSdf => (5, [0.0; 4], 0.0),
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable, PartialEq)]
pub struct GlassUniforms {
    pub rect_origin: [f32; 2],
    pub rect_size: [f32; 2],
    pub backdrop_size: [f32; 2],
    pub shape_mode: u32,
    pub corner_smoothing: f32,
    pub corner_radii: [f32; 4],
    pub light_angle_rad: f32,
    pub light_intensity: f32,
    pub refraction: f32,
    pub depth: f32,
    pub dispersion: f32,
    pub frost: f32,
    pub splay: f32,
    pub rotation_rad: f32,
    pub fill_color: [f32; 3],
    pub fill_opacity: f32,
    pub blur_dir: [f32; 2],
    pub blur_sigma: f32,
    pub _pad0: f32,
}

impl GlassUniforms {
    #[allow(clippy::too_many_arguments)]
    pub fn from_figma_ui(
        origin: [f32; 2], size: [f32; 2], backdrop: [f32; 2],
        corner_radii: [f32; 4], corner_smoothing: f32,
        light_angle_deg: f32, light_intensity_pct: f32,
        refraction: f32, depth: f32, dispersion: f32, frost: f32, splay: f32,
        rotation_deg: f32, fill_rgb: [f32; 3], fill_opacity_pct: f32,
    ) -> Self {
        let sigma = (0.65_f32.powi(2) + (0.425 * frost.max(0.0)).powi(2)).sqrt();
        Self {
            rect_origin: origin, rect_size: size, backdrop_size: backdrop,
            shape_mode: 0, corner_smoothing: corner_smoothing.clamp(0.0, 1.0), corner_radii,
            light_angle_rad: light_angle_deg.to_radians(),
            light_intensity: (light_intensity_pct / 100.0).clamp(0.0, 1.0),
            refraction: (refraction / 100.0).clamp(0.0, 1.0),
            depth: depth.clamp(0.0, 100.0),
            dispersion: (dispersion / 100.0).clamp(0.0, 1.0),
            frost: frost.max(0.0),
            splay: (splay / 100.0).clamp(0.0, 1.0),
            rotation_rad: rotation_deg.to_radians(),
            fill_color: fill_rgb,
            fill_opacity: (fill_opacity_pct / 100.0).clamp(0.0, 1.0),
            blur_dir: [1.0, 0.0], blur_sigma: sigma, _pad0: 0.0,
        }
    }
}

struct CachedBgs {
    blur_h: wgpu::BindGroup,
    blur_v: wgpu::BindGroup,
    main: wgpu::BindGroup,
    blit: wgpu::BindGroup,
}

#[wasm_bindgen]
pub struct FigmaGlassEngine {
    device: wgpu::Device,
    queue: wgpu::Queue,
    blur_pipeline: wgpu::ComputePipeline,
    glass_pipeline: wgpu::ComputePipeline,
    bgl: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    u_buf_h: wgpu::Buffer,
    u_buf_v: wgpu::Buffer,
    u_buf_main: wgpu::Buffer,
    blit_pipeline: wgpu::RenderPipeline,
    blit_bgl: wgpu::BindGroupLayout,
    raw_tex: Option<wgpu::Texture>,
    temp_tex: Option<wgpu::Texture>,
    preblur_tex: Option<wgpu::Texture>,
    dummy_sdf_tex: wgpu::Texture,
    out_tex: Option<wgpu::Texture>,
    cached_bgs: Option<CachedBgs>,
    surface: Option<wgpu::Surface<'static>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
    width: u32,
    height: u32,
    blur_dirty: bool,
    cached_sigma: f32,
}

impl FigmaGlassEngine {
    pub fn render_declarative(&mut self, origin: [f32; 2], size: [f32; 2], glass: Glass, shape: GlassShape) -> Result<(), JsValue> {
        let (mode, r, sm) = shape.resolve(size);
        self.render(
            origin[0], origin[1], size[0], size[1], mode,
            r[0], r[1], r[2], r[3], sm,
            glass.light_angle_deg, glass.light_intensity_pct,
            glass.refraction, glass.depth, glass.dispersion, glass.frost, glass.splay,
            glass.rotation_deg, glass.fill_rgb[0], glass.fill_rgb[1], glass.fill_rgb[2], glass.fill_opacity_pct,
        )
    }

    fn rebuild_bgs(&mut self) {
        let (Some(raw), Some(tmp), Some(pre), Some(out)) = (&self.raw_tex, &self.temp_tex, &self.preblur_tex, &self.out_tex) else {
            self.cached_bgs = None; return;
        };
        let rv = raw.create_view(&Default::default());
        let tv = tmp.create_view(&Default::default());
        let pv = pre.create_view(&Default::default());
        let sv = self.dummy_sdf_tex.create_view(&Default::default());
        let ov = out.create_view(&Default::default());
        let mk = |ub: &wgpu::Buffer, src: &wgpu::TextureView, dst: &wgpu::TextureView| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None, layout: &self.bgl,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: ub.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(src) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                    wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&sv) },
                    wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(dst) },
                    wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(&rv) },
                ],
            })
        };
        let blit = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None, layout: &self.blit_bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&ov) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        });
        self.cached_bgs = Some(CachedBgs {
            blur_h: mk(&self.u_buf_h, &rv, &tv),
            blur_v: mk(&self.u_buf_v, &tv, &pv),
            main: mk(&self.u_buf_main, &pv, &ov),
            blit,
        });
    }

    fn alloc_textures(&mut self, w: u32, h: u32) {
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        let desc = |label| wgpu::TextureDescriptor {
            label: Some(label), size, mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
        };
        self.temp_tex = Some(self.device.create_texture(&desc("Temp Blur")));
        self.preblur_tex = Some(self.device.create_texture(&desc("Preblur")));
        self.out_tex = Some(self.device.create_texture(&desc("Final Out")));
        self.blur_dirty = true;
    }
}

#[wasm_bindgen]
impl FigmaGlassEngine {
    pub async fn create(canvas: web_sys::HtmlCanvasElement) -> Result<FigmaGlassEngine, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        { let _ = canvas; Err(JsValue::from_str("Requires wasm32 target")) }
        #[cfg(target_arch = "wasm32")]
        {
            console_error_panic_hook::set_once();
            let width = canvas.width().max(1);
            let height = canvas.height().max(1);
            let instance = wgpu::Instance::default();
            let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas))
                .map_err(|e| JsValue::from_str(&format!("{:?}", e)))?;
            let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface), force_fallback_adapter: false,
            }).await.ok_or_else(|| JsValue::from_str("No WebGPU adapter"))?;
            let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("Figma Glass Clean"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()),
                memory_hints: wgpu::MemoryHints::Performance,
            }, None).await.map_err(|e| JsValue::from_str(&format!("{:?}", e)))?;

            let caps = surface.get_capabilities(&adapter);
            let fmt = caps.formats.iter().copied().find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
            let surface_config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT, format: fmt, width, height,
                present_mode: wgpu::PresentMode::AutoVsync, alpha_mode: caps.alpha_modes[0],
                view_formats: vec![], desired_maximum_frame_latency: 2,
            };
            surface.configure(&device, &surface_config);

            // 100% UNMODIFIED ORIGINAL figma_glass.wgsl
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Original Figma Glass WGSL"),
                source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/figma_glass.wgsl").into()),
            });
            let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: None,
                entries: &[
                    wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                    wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                    wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
                    wgpu::BindGroupLayoutEntry { binding: 3, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                    wgpu::BindGroupLayoutEntry { binding: 4, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::StorageTexture { access: wgpu::StorageTextureAccess::WriteOnly, format: wgpu::TextureFormat::Rgba8Unorm, view_dimension: wgpu::TextureViewDimension::D2 }, count: None },
                    wgpu::BindGroupLayoutEntry { binding: 5, visibility: wgpu::ShaderStages::COMPUTE, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                ],
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[&bgl], push_constant_ranges: &[] });
            let blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor { label: None, layout: Some(&layout), module: &shader, entry_point: Some("cs_gaussian_blur"), compilation_options: Default::default(), cache: None });
            let glass_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor { label: None, layout: Some(&layout), module: &shader, entry_point: Some("cs_figma_liquid_glass"), compilation_options: Default::default(), cache: None });

            let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: None,
                source: wgpu::ShaderSource::Wgsl(r#"
                    @vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
                        var p = array<vec2<f32>, 3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
                        return vec4<f32>(p[i], 0.0, 1.0);
                    }
                    @group(0) @binding(0) var tex: texture_2d<f32>;
                    @group(0) @binding(1) var smp: sampler;
                    @fragment fn fs_main(@builtin(position) c: vec4<f32>) -> @location(0) vec4<f32> {
                        return textureSample(tex, smp, c.xy / vec2<f32>(textureDimensions(tex)));
                    }
                "#.into()),
            });
            let blit_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: None,
                entries: &[
                    wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                    wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
                ],
            });
            let blit_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[&blit_bgl], push_constant_ranges: &[] });
            let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: None, layout: Some(&blit_layout),
                vertex: wgpu::VertexState { module: &blit_shader, entry_point: Some("vs_main"), buffers: &[], compilation_options: Default::default() },
                fragment: Some(wgpu::FragmentState {
                    module: &blit_shader, entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState { format: fmt, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(), depth_stencil: None, multisample: Default::default(), multiview: None, cache: None,
            });

            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                label: None, address_mode_u: wgpu::AddressMode::ClampToEdge, address_mode_v: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default()
            });
            let zero_u = GlassUniforms::zeroed();
            let mk_u = |lbl| device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(lbl), contents: bytemuck::bytes_of(&zero_u), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
            let u_buf_h = mk_u("U H");
            let u_buf_v = mk_u("U V");
            let u_buf_main = mk_u("U Main");
            let dummy_sdf_tex = device.create_texture(&wgpu::TextureDescriptor {
                label: None, size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm, usage: wgpu::TextureUsages::TEXTURE_BINDING, view_formats: &[],
            });

            let mut eng = Self {
                device, queue, blur_pipeline, glass_pipeline, bgl, sampler,
                u_buf_h, u_buf_v, u_buf_main, blit_pipeline, blit_bgl,
                raw_tex: None, temp_tex: None, preblur_tex: None, dummy_sdf_tex, out_tex: None,
                cached_bgs: None, surface: Some(surface), surface_config: Some(surface_config),
                width, height, blur_dirty: true, cached_sigma: -1.0,
            };
            eng.alloc_textures(width, height);
            Ok(eng)
        }
    }

    pub fn set_backdrop_image(&mut self, rgba: &[u8], width: u32, height: u32) {
        let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Raw Backdrop"), size, mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST, view_formats: &[],
        });
        self.queue.write_texture(
            wgpu::ImageCopyTexture { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            rgba, wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(4 * width), rows_per_image: Some(height) }, size,
        );
        self.raw_tex = Some(tex);
        if self.width != width || self.height != height {
            self.width = width; self.height = height;
            if let (Some(s), Some(c)) = (&self.surface, &mut self.surface_config) {
                c.width = width; c.height = height; s.configure(&self.device, c);
            }
            self.alloc_textures(width, height);
        }
        self.blur_dirty = true;
        self.rebuild_bgs();
    }

    #[cfg(target_arch = "wasm32")]
    pub fn upload_video_frame(&mut self, video: &web_sys::HtmlVideoElement) {
        let vw = video.video_width().max(1);
        let vh = video.video_height().max(1);
        if self.raw_tex.is_none() || self.width != vw || self.height != vh {
            let size = wgpu::Extent3d { width: vw, height: vh, depth_or_array_layers: 1 };
            self.raw_tex = Some(self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Zero-Copy Video"), size, mip_level_count: 1, sample_count: 1,
                dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            }));
            self.width = vw; self.height = vh;
            self.alloc_textures(vw, vh);
            self.rebuild_bgs();
        }
        if let Some(tex) = &self.raw_tex {
            self.queue.copy_external_image_to_texture(
                &wgpu::ImageCopyExternalImage { source: wgpu::ExternalImageSource::HTMLVideoElement(video.clone()), origin: wgpu::Origin2d::ZERO, flip_y: false },
                wgpu::ImageCopyTextureTagged { texture: tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All, color_space: wgpu::PredefinedColorSpace::Srgb, premultiplied_alpha: false },
                wgpu::Extent3d { width: vw, height: vh, depth_or_array_layers: 1 },
            );
            self.blur_dirty = true;
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self, origin_x: f32, origin_y: f32, width: f32, height: f32, shape_mode: u32,
        r_tl: f32, r_tr: f32, r_br: f32, r_bl: f32, corner_smoothing: f32,
        light_angle_deg: f32, light_intensity_pct: f32,
        refraction: f32, depth: f32, dispersion: f32, frost: f32, splay: f32,
        rotation_deg: f32, fill_r: f32, fill_g: f32, fill_b: f32, fill_opacity_pct: f32,
    ) -> Result<(), JsValue> {
        let bgs = self.cached_bgs.as_ref().ok_or_else(|| JsValue::from_str("No backdrop loaded"))?;
        let mut u = GlassUniforms::from_figma_ui(
            [origin_x, origin_y], [width, height], [self.width as f32, self.height as f32],
            [r_tl, r_tr, r_br, r_bl], corner_smoothing, light_angle_deg, light_intensity_pct,
            refraction, depth, dispersion, frost, splay, rotation_deg, [fill_r, fill_g, fill_b], fill_opacity_pct,
        );
        u.shape_mode = shape_mode;

        let need_blur = self.blur_dirty || (u.blur_sigma - self.cached_sigma).abs() > 1e-5;
        if need_blur {
            let mut uh = u; uh.blur_dir = [1.0, 0.0];
            let mut uv = u; uv.blur_dir = [0.0, 1.0];
            self.queue.write_buffer(&self.u_buf_h, 0, bytemuck::bytes_of(&uh));
            self.queue.write_buffer(&self.u_buf_v, 0, bytemuck::bytes_of(&uv));
        }
        self.queue.write_buffer(&self.u_buf_main, 0, bytemuck::bytes_of(&u));

        let wg_x = (self.width + 7) / 8;
        let wg_y = (self.height + 7) / 8;
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let mut cp = enc.begin_compute_pass(&Default::default());
            if need_blur {
                cp.set_pipeline(&self.blur_pipeline);
                cp.set_bind_group(0, &bgs.blur_h, &[]);
                cp.dispatch_workgroups(wg_x, wg_y, 1);
                cp.set_bind_group(0, &bgs.blur_v, &[]);
                cp.dispatch_workgroups(wg_x, wg_y, 1);
                self.blur_dirty = false;
                self.cached_sigma = u.blur_sigma;
            }
            cp.set_pipeline(&self.glass_pipeline);
            cp.set_bind_group(0, &bgs.main, &[]);
            cp.dispatch_workgroups(wg_x, wg_y, 1);
        }

        let frame_opt = if let Some(s) = &self.surface {
            let frame = s.get_current_texture().map_err(|e| JsValue::from_str(&format!("{:?}", e)))?;
            let fv = frame.texture.create_view(&Default::default());
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &fv, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None,
            });
            rp.set_pipeline(&self.blit_pipeline);
            rp.set_bind_group(0, &bgs.blit, &[]);
            rp.draw(0..3, 0..1);
            Some(frame)
        } else { None };

        self.queue.submit(Some(enc.finish()));
        if let Some(f) = frame_opt { f.present(); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniforms_match_exact_original_contract() {
        let g = Glass::regular();
        let (mode, r, sm) = GlassShape::rect(32.0).resolve([480.0, 320.0]);
        let mut u = GlassUniforms::from_figma_ui(
            [272.0, 224.0], [480.0, 320.0], [1024.0, 768.0], r, sm,
            g.light_angle_deg, g.light_intensity_pct, g.refraction, g.depth,
            g.dispersion, g.frost, g.splay, g.rotation_deg, g.fill_rgb, g.fill_opacity_pct,
        );
        u.shape_mode = mode;
        assert_eq!(u.shape_mode, 0);
        assert_eq!(u.refraction, 1.0);
        assert_eq!(u.depth, 100.0);
        assert_eq!(u.dispersion, 0.2);
        assert!((u.blur_sigma - (0.65_f32.powi(2) + (0.425 * 4.0_f32).powi(2)).sqrt()).abs() < 1e-6);
    }
}
