import ExpoModulesCore

public class MusicWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MusicWidget")

    AsyncFunction("updateWidget") { (title: String, artist: String, artworkUri: String?, isPlaying: Bool, bgColorHex: String?) in
      // No-op on iOS
    }

    Function("moveAppToBack") { () -> Bool in
      return false
    }
  }
}
