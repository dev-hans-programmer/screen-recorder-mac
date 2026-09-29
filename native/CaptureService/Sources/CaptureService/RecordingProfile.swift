import Foundation

#if canImport(AVFoundation)
import AVFoundation
#endif

#if canImport(CoreMedia)
import CoreMedia
#endif

#if canImport(VideoToolbox)
import VideoToolbox
#endif

enum NativeRecordingProfileId: String, Codable, Sendable, CaseIterable {
  case compatible
  case balanced
  case master

  var codec: NativeVideoCodec {
    switch self {
    case .compatible:
      return .h264
    case .balanced:
      return .hevc
    case .master:
      return .proRes422
    }
  }

  var container: NativeRecordingContainer {
    switch self {
    case .compatible, .balanced:
      return .mp4
    case .master:
      return .mov
    }
  }
}

enum NativeVideoCodec: String, Codable, Sendable {
  case h264
  case hevc
  case proRes422 = "prores422"

#if canImport(AVFoundation)
  var avCodecType: AVVideoCodecType {
    switch self {
    case .h264:
      return .h264
    case .hevc:
      return .hevc
    case .proRes422:
      return .proRes422
    }
  }
#endif
}

enum NativeRecordingContainer: String, Codable, Sendable {
  case mp4
  case mov

#if canImport(AVFoundation)
  var avFileType: AVFileType {
    switch self {
    case .mp4:
      return .mp4
    case .mov:
      return .mov
    }
  }
#endif
}

struct NativeEncoderCapabilities: Sendable {
  static var hardwareProfileIds: [String] {
    NativeRecordingProfileId.allCases.compactMap { profile in
      isHardwareEncoderAvailable(for: profile) ? profile.rawValue : nil
    }
  }

  static func isHardwareEncoderAvailable(for profile: NativeRecordingProfileId) -> Bool {
#if canImport(VideoToolbox) && canImport(CoreMedia)
    switch profile.codec {
    case .h264:
      return isHardwareEncoderAvailable(codecType: kCMVideoCodecType_H264)
    case .hevc:
      return isHardwareEncoderAvailable(codecType: kCMVideoCodecType_HEVC)
    case .proRes422:
      return isHardwareEncoderAvailable(codecType: kCMVideoCodecType_AppleProRes422)
    }
#else
    _ = profile
    return false
#endif
  }

#if canImport(VideoToolbox) && canImport(CoreMedia)
  private static func isHardwareEncoderAvailable(codecType: CMVideoCodecType) -> Bool {
    var encoderList: CFArray?
    guard VTCopyVideoEncoderList(nil, &encoderList) == noErr,
      let encoderList,
      let encoders = encoderList as? [[String: Any]]
    else {
      return false
    }

    let codecTypeKey = kVTVideoEncoderList_CodecType as String
    let hardwareKey = kVTVideoEncoderList_IsHardwareAccelerated as String

    return encoders.contains { encoder in
      let reportedCodecType = (encoder[codecTypeKey] as? NSNumber)?.uint32Value
      let isHardware = (encoder[hardwareKey] as? NSNumber)?.boolValue ?? false
      return reportedCodecType == codecType && isHardware
    }
  }
#endif
}
