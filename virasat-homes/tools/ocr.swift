import Foundation
import Vision
import AppKit
// usage: ocr <image> <tileSize> <overlap>  → prints JSON lines: text, x, y, w, h (pixel coords, top-left origin), conf
let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[1])
let tile = Int(args[2]) ?? 1200
let overlap = Int(args[3]) ?? 200
guard let src = NSImage(contentsOf: url), let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("load") }
let W = cg.width, H = cg.height
var y = 0
while y < H {
  var x = 0
  while x < W {
    let w = min(tile, W - x), h = min(tile, H - y)
    if let crop = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h)) {
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate
      req.usesLanguageCorrection = false
      req.minimumTextHeight = 0.0
      let handler = VNImageRequestHandler(cgImage: crop, options: [:])
      try? handler.perform([req])
      for obs in req.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        let px = Double(x) + Double(b.minX) * Double(w)
        let py = Double(y) + Double(1 - b.maxY) * Double(h)
        let pw = Double(b.width) * Double(w), ph = Double(b.height) * Double(h)
        let s = cand.string.replacingOccurrences(of: "\"", with: "\\\"")
        print("{\"t\":\"\(s)\",\"x\":\(px),\"y\":\(py),\"w\":\(pw),\"h\":\(ph),\"c\":\(cand.confidence)}")
      }
    }
    if x + w >= W { break }
    x += tile - overlap
  }
  if y + tile >= H { break }
  y += tile - overlap
}
