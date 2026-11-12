import SwiftUI
import WebKit

struct HotspotWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 11/255, green: 15/255, blue: 25/255, alpha: 1.0)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ContentView: View {
    var body: some View {
        HotspotWebView(url: URL(string: "http://127.0.0.1:8080")!)
            .edgesIgnoringSafeArea(.all)
            .preferredColorScheme(.dark)
    }
}
