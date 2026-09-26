// Runs the SAME dependency-free Rust kernel used in the native app. Input is PGM
// screenshots + initial seed; subsequent target positions are never inputs.
#[path = "../../src-tauri/src/visual_tracker.rs"] mod visual_tracker;
use visual_tracker::{Gray, Rect, Seed, Tracker};
use std::{fs, sync::Arc, time::Instant};
fn pgm(path: &str) -> Gray {
    let bytes = fs::read(path).unwrap();
    let mut i = 0; let mut words = Vec::new();
    while words.len() < 4 { while bytes[i].is_ascii_whitespace() { i += 1; } let from = i; while !bytes[i].is_ascii_whitespace() { i += 1; } words.push(std::str::from_utf8(&bytes[from..i]).unwrap().to_owned()); }
    assert_eq!(words[0], "P5"); assert_eq!(words[3], "255"); i += 1;
    let g = Gray { width: words[1].parse().unwrap(), height: words[2].parse().unwrap(), pixels: bytes[i..].to_vec() }; assert!(g.valid()); g
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let numbers = args[2].split(',').map(|s| s.parse::<usize>().unwrap()).collect::<Vec<_>>();
    let rect = |n| Rect { x: numbers[n], y: numbers[n+1], width: numbers[n+2], height: numbers[n+3] };
    let seed=Seed{target:rect(0),context:rect(4),search:rect(8),identity:rect(12)};
    let baseline=Arc::new(pgm(&args[1])); let mut tracker=match Tracker::new(baseline,seed){Ok(t)=>t,Err(error)=>{println!("SEED_ERROR,{error}");return}};
    for file in &args[3..] { let image=pgm(file); let t=Instant::now();let o=tracker.update(&image);let ms=t.elapsed().as_secs_f64()*1000.;let r=o.rect.unwrap_or(Rect{x:0,y:0,width:0,height:0});println!("{},{},{},{},{},{},{:.4},{},{}",file,o.status.name(),r.x,r.y,r.width,r.height,ms,o.probes,o.dy); }
}
