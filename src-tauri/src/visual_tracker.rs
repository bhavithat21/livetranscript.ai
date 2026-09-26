//! Screenshot-only visual anchoring. No OCR, editor text, accessibility or DOM.
//! Immutable full-resolution templates prevent drift. Any ambiguous, clipped,
//! edited or resized target is withheld. Similarity scores are not probabilities.
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect { pub x: usize, pub y: usize, pub width: usize, pub height: usize }
impl Rect {
    pub fn right(self) -> usize { self.x.saturating_add(self.width) }
    pub fn bottom(self) -> usize { self.y.saturating_add(self.height) }
    pub fn contains(self, x: usize, y: usize) -> bool { x >= self.x && y >= self.y && x < self.right() && y < self.bottom() }
    pub fn inside(self, outer: Rect) -> bool { self.width > 0 && self.height > 0 && self.x >= outer.x && self.y >= outer.y && self.right() <= outer.right() && self.bottom() <= outer.bottom() }
}
#[derive(Clone, Debug)]
pub struct Gray { pub width: usize, pub height: usize, pub pixels: Vec<u8> }
impl Gray {
    pub fn valid(&self) -> bool { self.width >= 32 && self.height >= 32 && self.width <= 8192 && self.height <= 8192 && self.width.saturating_mul(self.height) <= 16_000_000 && self.pixels.len() == self.width * self.height }
    pub fn bounds(&self) -> Rect { Rect { x: 0, y: 0, width: self.width, height: self.height } }
    fn at(&self, x: usize, y: usize) -> u8 { self.pixels[y * self.width + x] }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status { Tracking, Lost, Edited, Ambiguous, LayoutChanged, IdentityChanged, Budget }
impl Status {
    pub fn name(self) -> &'static str { match self { Self::Tracking => "tracking", Self::Lost => "lost", Self::Edited => "edited", Self::Ambiguous => "ambiguous", Self::LayoutChanged => "layout-changed", Self::IdentityChanged => "identity-changed", Self::Budget => "budget" } }
}
#[derive(Clone, Debug)]
pub struct Update { pub status: Status, pub rect: Option<Rect>, pub dx: i32, pub dy: i32, pub probes: usize }
#[derive(Clone, Debug)]
pub struct Seed { pub target: Rect, pub context: Rect, pub search: Rect, pub identity: Rect, pub watch: Vec<Rect> }
#[derive(Clone, Debug)]
pub struct Tracker {
    baseline: Arc<Gray>, seed: Seed, features: Vec<(usize, usize, u8)>,
    last: Rect, terminal: Option<Status>,
}
const MAX_PROBES: usize = 1_500_000;
const MAX_FEATURES: usize = 24;

impl Tracker {
    pub fn new(image: Arc<Gray>, seed: Seed) -> Result<Self, &'static str> {
        if !image.valid() || !seed.context.inside(seed.search) || !seed.search.inside(image.bounds()) || !seed.target.inside(seed.context) || !seed.identity.inside(image.bounds()) { return Err("Invalid visual seed geometry"); }
        if seed.context.width * seed.context.height > 600_000 || seed.target.width < 16 || seed.target.height < 5 || seed.identity.width * seed.identity.height > 1_500_000 { return Err("Visual seed outside memory/size limits"); }
        if seed.watch.len()>3 || seed.watch.iter().any(|r|!r.inside(image.bounds())||overlaps(*r,seed.search)||overlaps(*r,seed.identity)) { return Err("Invalid stationary watched regions"); }
        if overlaps(seed.identity, seed.search) { return Err("File identity must be outside the moving editor region"); }
        // Surrounding pixels, NOT the target itself, locate a changed target too.
        // Collect separated edges across different bands; flat/repetitive targets
        // cannot create an apparently precise anchor.
        let mut pool = Vec::new();
        for y in seed.context.y + 1..seed.context.bottom().saturating_sub(1) {
            for x in seed.context.x + 1..seed.context.right().saturating_sub(1) {
                if seed.target.contains(x, y) { continue; }
                let p = image.at(x, y);
                let edge = p.abs_diff(image.at(x - 1, y)).max(p.abs_diff(image.at(x, y - 1)));
                if edge >= 35 { pool.push((x - seed.context.x, y - seed.context.y, p)); }
            }
        }
        if pool.len() < MAX_FEATURES { return Err("Insufficient distinctive surrounding pixels"); }
        let features = (0..MAX_FEATURES).map(|i| pool[(i * pool.len() / MAX_FEATURES + i * 7) % pool.len()]).collect::<Vec<_>>();
        let bands = features.iter().map(|p| p.1 / 8).collect::<std::collections::HashSet<_>>();
        if bands.len() < 3 { return Err("Need surrounding text on multiple pixel rows"); }
        let last = seed.context;
        let mut value = Self { baseline: image.clone(), seed, features, last, terminal: None };
        let found = value.update(&image);
        if found.status != Status::Tracking { return Err("Initial visual anchor is not unique"); }
        Ok(value)
    }
    pub fn update(&mut self, image: &Gray) -> Update {
        let empty = |status, probes| Update { status, rect: None, dx: 0, dy: 0, probes };
        if let Some(status) = self.terminal { return empty(status, 0); }
        if !image.valid() || image.width != self.baseline.width || image.height != self.baseline.height { self.terminal = Some(Status::LayoutChanged); return empty(Status::LayoutChanged, 0); }
        if !same_region(&self.baseline, self.seed.identity, image, self.seed.identity, None) {
            // Sticky: once a file/tab change is observed, matching old pixels later
            // cannot resurrect an old recommendation. A new semantic seed is needed.
            self.terminal = Some(Status::IdentityChanged); return empty(Status::IdentityChanged, 0);
        }
        let s = self.seed.search; let c = self.seed.context; let t = self.seed.target;
        let mut candidates = Vec::new(); let mut probes = 0;
        // Full bounded search, not nearest-match-only. Repeated blocks anywhere
        // within the observed pane must make the result ambiguous.
        for y in s.y..=s.bottom() - c.height {
            for x in s.x..=s.right() - c.width {
                probes += 1;
                if probes > MAX_PROBES { return empty(Status::Budget, probes); }
                let mut error = 0u32;
                for &(fx, fy, expected) in &self.features {
                    error += u32::from(image.at(x + fx, y + fy).abs_diff(expected));
                    if error > 120 { break; }
                }
                if error > 120 { continue; }
                let candidate = Rect { x, y, ..c };
                let ignored = Rect { x: t.x - c.x, y: t.y - c.y, ..t };
                if same_region(&self.baseline, c, image, candidate, Some(ignored)) {
                    candidates.push(candidate);
                    if candidates.len() > 1 { return empty(Status::Ambiguous, probes); }
                }
            }
        }
        let Some(candidate) = candidates.first().copied() else { return empty(Status::Lost, probes); };
        let target = Rect { x: candidate.x + t.x - c.x, y: candidate.y + t.y - c.y, ..t };
        if !same_region(&self.baseline, t, image, target, None) {
            // Never adapt the template to an edit or silently resume if it is undone.
            self.terminal = Some(Status::Edited); return empty(Status::Edited, probes);
        }
        let dx = candidate.x as i32 - self.last.x as i32;
        let dy = candidate.y as i32 - self.last.y as i32;
        self.last = candidate;
        Update { status: Status::Tracking, rect: Some(target), dx, dy, probes }
    }
    /// Separate recommendation freshness from target position. Align the known
    /// editor pixels against the immutable reference before looking for edits.
    /// Newly exposed scroll edges are unknown, not reconstructed as source text.
    pub fn semantic_dirty(&self, image: &Gray) -> bool {
        if !image.valid() || image.width != self.baseline.width || image.height != self.baseline.height { return true; }
        let s = self.seed.search;
        let dx = self.last.x as i32 - self.seed.context.x as i32;
        let dy = self.last.y as i32 - self.seed.context.y as i32;
        let x = (s.x as i32).max(s.x as i32 + dx);
        let y = (s.y as i32).max(s.y as i32 + dy);
        let right = (s.right() as i32).min(s.right() as i32 + dx);
        let bottom = (s.bottom() as i32).min(s.bottom() as i32 + dy);
        if right <= x || bottom <= y { return true; }
        let current = Rect { x:x as usize, y:y as usize, width:(right-x) as usize, height:(bottom-y) as usize };
        let before = Rect { x:(x-dx) as usize, y:(y-dy) as usize, ..current };
        if !same_region(&self.baseline, before, image, current, None) { return true; }
        // Only separately identified output regions are watched. Comparing ALL
        // pixels outside the code viewport mistakes scrollbars/clipped edges for
        // semantic changes. Unknown areas are not claimed to be monitored.
        for region in &self.seed.watch {
            if !same_region(&self.baseline,*region,image,*region,None) { return true; }
        }
        false
    }

    pub fn image_size(&self) -> (usize, usize) { (self.baseline.width, self.baseline.height) }
}
fn overlaps(a: Rect, b: Rect) -> bool { a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom() }
// Two strong changed pixels in an 8x8 tile invalidate even when the whole-line
// average is tiny (e.g. || -> &&, > -> >=). Unquantized native-resolution luma.
// Antialiasing differences, selection and caret occlusion can cause safe misses.
fn same_region(a: &Gray, ar: Rect, b: &Gray, br: Rect, ignore: Option<Rect>) -> bool {
    for ty in (0..ar.height).step_by(8) {
        for tx in (0..ar.width).step_by(8) {
            let mut strong = 0; let mut sum = 0u32;
            for y in ty..(ty + 8).min(ar.height) {
                for x in tx..(tx + 8).min(ar.width) {
                    if ignore.is_some_and(|r| r.contains(x, y)) { continue; }
                    let delta = a.at(ar.x + x, ar.y + y).abs_diff(b.at(br.x + x, br.y + y));
                    if delta >= 24 { strong += 1; }
                    sum += u32::from(delta);
                    if strong >= 2 || sum > 500 { return false; }
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Arc<Gray>, Seed) {
        let mut im = Gray { width: 360, height: 280, pixels: vec![22; 360 * 280] };
        let seed = Seed { target: Rect { x: 70, y: 100, width: 130, height: 16 }, context: Rect { x: 60, y: 70, width: 180, height: 90 }, search: Rect { x: 40, y: 40, width: 270, height: 220 }, identity: Rect { x: 10, y: 4, width: 310, height: 24 }, watch:vec![Rect{x:0,y:270,width:360,height:10}] };
        let mut rng = 0x12345678u32;
        for y in seed.context.y..seed.context.bottom() { for x in seed.context.x..seed.context.right() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; im.pixels[y * im.width + x] = if rng % 11 < 2 { 190 + (rng % 60) as u8 } else { 22 }; } }
        (Arc::new(im), seed)
    }
    fn moved(im: &Gray, seed: &Seed, dx: i32, dy: i32) -> Gray {
        let mut next = im.clone();
        for y in seed.search.y..seed.search.bottom() { for x in seed.search.x..seed.search.right() {
            let bx = x as i32 - dx; let by = y as i32 - dy;
            next.pixels[y * im.width + x] = if bx >= 0 && by >= 0 && seed.search.contains(bx as usize, by as usize) { im.at(bx as usize, by as usize) } else { 22 };
        } }
        next
    }
    #[test] fn tracks_integer_vertical_and_horizontal_motion_without_template_drift() {
        let (im, seed) = fixture(); let mut tracker = Tracker::new(im.clone(), seed.clone()).unwrap();
        for (dx,dy) in [(0,-20),(4,8),(-7,39),(0,0),(8,-5)] { let next = moved(&im,&seed,dx,dy);let out=tracker.update(&next);assert_eq!(out.status,Status::Tracking);assert_eq!(out.rect.unwrap().x as i32,seed.target.x as i32+dx);assert_eq!(out.rect.unwrap().y as i32,seed.target.y as i32+dy); }
    }
    #[test] fn exact_original_is_stable() { let (im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed).unwrap();for _ in 0..30{assert_eq!(t.update(&im).status,Status::Tracking);} }
    #[test] fn two_pixel_operator_edit_is_sticky() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed.clone()).unwrap();let mut changed=im.as_ref().clone();for x in seed.target.x..seed.target.x+2{let p=&mut changed.pixels[(seed.target.y+4)*im.width+x];*p=255-*p;}assert_eq!(t.update(&changed).status,Status::Edited);assert_eq!(t.update(&im).status,Status::Edited); }
    #[test] fn offscreen_then_return_reacquires_without_new_seed() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed.clone()).unwrap();assert_eq!(t.update(&moved(&im,&seed,0,200)).status,Status::Lost);assert_eq!(t.update(&im).status,Status::Tracking); }
    #[test] fn file_identity_change_is_sticky() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed).unwrap();let mut changed=im.as_ref().clone();changed.pixels[5*im.width+10]=200;changed.pixels[5*im.width+11]=200;assert_eq!(t.update(&changed).status,Status::IdentityChanged);assert_eq!(t.update(&im).status,Status::IdentityChanged); }
    #[test] fn ambiguous_blocks_fail_seed() { let(im,mut seed)=fixture();let mut dup=im.as_ref().clone();seed.context.height=60;seed.search.height=230;for y in 0..60{for x in 0..180{dup.pixels[(seed.context.y+110+y)*im.width+seed.context.x+x]=im.at(seed.context.x+x,seed.context.y+y);}}assert!(Tracker::new(Arc::new(dup),seed).is_err()); }
    #[test] fn resized_frame_requires_new_seed() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed).unwrap();let next=Gray{width:320,height:280,pixels:vec![22;320*280]};assert_eq!(t.update(&next).status,Status::LayoutChanged); }
    #[test] fn flat_surrounding_pixels_abstain() { let(im,seed)=fixture();let next=Gray{width:im.width,height:im.height,pixels:vec![22;im.width*im.height]};assert!(Tracker::new(Arc::new(next),seed).is_err()); }
    #[test] fn malformed_rects_and_image_are_rejected() { let(im,mut seed)=fixture();seed.target.width=usize::MAX;assert!(Tracker::new(im.clone(),seed).is_err()); }
    #[test] fn surrounding_code_edit_does_not_follow_wrong_text() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed.clone()).unwrap();let mut changed=im.as_ref().clone();for x in seed.context.x..seed.context.x+4{changed.pixels[(seed.context.y+10)*im.width+x]^=255;}assert_ne!(t.update(&changed).status,Status::Tracking); }
    #[test] fn unrelated_terminal_pixels_do_not_move_target() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed).unwrap();let mut changed=im.as_ref().clone();changed.pixels[279*im.width+10]=255;assert_eq!(t.update(&changed).status,Status::Tracking); }
    #[test] fn pure_scroll_is_not_a_semantic_edit() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed.clone()).unwrap();let next=moved(&im,&seed,0,-18);assert_eq!(t.update(&next).status,Status::Tracking);assert!(!t.semantic_dirty(&next)); }
    #[test] fn off_target_editor_edit_requires_semantic_review() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed.clone()).unwrap();let mut next=im.as_ref().clone();for x in 60..64{next.pixels[220*im.width+x]=200;}assert_eq!(t.update(&next).status,Status::Tracking);assert!(t.semantic_dirty(&next)); }
    #[test] fn persistent_terminal_change_remains_dirty() { let(im,seed)=fixture();let mut t=Tracker::new(im.clone(),seed).unwrap();let mut next=im.as_ref().clone();for x in 0..80{next.pixels[272*im.width+x]=200;}for _ in 0..3{assert_eq!(t.update(&next).status,Status::Tracking);assert!(t.semantic_dirty(&next));} }

}
