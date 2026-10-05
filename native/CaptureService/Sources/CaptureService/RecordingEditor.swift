import Foundation

#if canImport(AppKit) && canImport(AVFoundation) && canImport(CoreMedia)
import AppKit
import AVFoundation
import CoreMedia

actor RecordingEditor {
  func export(_ payload: RecordingEditPayload) async throws -> NativeEditedRecordingResult {
    let configuration = try RecordingEditConfiguration(payload)
    let inputURL = URL(fileURLWithPath: configuration.inputPath)
    let outputURL = URL(fileURLWithPath: configuration.outputPath)
    let thumbnailURL = URL(fileURLWithPath: configuration.thumbnailPath)
    let asset = AVURLAsset(url: inputURL)

    guard let sourceVideoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw NativeServiceError.invalidConfiguration("The source recording has no video track.")
    }

    let sourceDuration = try await asset.load(.duration)
    let sourceDurationSeconds = CMTimeGetSeconds(sourceDuration)
    guard sourceDurationSeconds.isFinite,
          configuration.trimEndMs <= sourceDurationSeconds * 1_000 + 1 else {
      throw NativeServiceError.invalidConfiguration(
        "The editor trim extends beyond the source recording."
      )
    }

    let composition = AVMutableComposition()
    let project = configuration.project
    let screenTrack = project?.tracks.first(where: { $0.kind == "screen" })
    let screenClip = screenTrack?.clips.first
    let fallbackSourceRange = CMTimeRange(
      start: time(milliseconds: configuration.trimStartMs),
      duration: time(milliseconds: configuration.trimEndMs - configuration.trimStartMs)
    )
    // A project clip maps a source interval to a separate interval on the composition timeline.
    let sourceRange: CMTimeRange
    let screenTimelineStartMs: Double
    let screenIsVisible: Bool
    if let screenClip {
      try validateSourceRange(
        startMs: screenClip.sourceStartMs,
        durationMs: screenClip.durationMs,
        sourceDurationMs: sourceDurationSeconds * 1_000
      )
      sourceRange = CMTimeRange(
        start: time(milliseconds: screenClip.sourceStartMs),
        duration: time(milliseconds: screenClip.durationMs)
      )
      screenTimelineStartMs = screenClip.timelineStartMs
      screenIsVisible = screenTrack?.visible ?? true
    } else {
      sourceRange = fallbackSourceRange
      screenTimelineStartMs = 0
      screenIsVisible = false
    }
    let compositionDurationMs = project.map { editingProject in
      editingProject.tracks
        .filter { ["screen", "microphone", "system-audio", "music"].contains($0.kind) }
        .flatMap(\.clips)
        .map { $0.timelineStartMs + $0.durationMs }
        .max() ?? 0
    } ?? (configuration.trimEndMs - configuration.trimStartMs)
    guard compositionDurationMs >= 100 else {
      throw NativeServiceError.invalidConfiguration("The editing project has no media to export.")
    }
    let compositionDuration = time(milliseconds: compositionDurationMs)
    guard let compositionVideoTrack = composition.addMutableTrack(
      withMediaType: .video,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The editor could not create its video track."
      )
    }
    if screenClip == nil {
      compositionVideoTrack.insertEmptyTimeRange(
        CMTimeRange(start: .zero, duration: compositionDuration)
      )
    } else {
      if screenTimelineStartMs > 0 {
        compositionVideoTrack.insertEmptyTimeRange(
          CMTimeRange(start: .zero, duration: time(milliseconds: screenTimelineStartMs))
        )
      }
      try compositionVideoTrack.insertTimeRange(
        sourceRange,
        of: sourceVideoTrack,
        at: time(milliseconds: screenTimelineStartMs)
      )
      let screenEnd = time(
        milliseconds: screenTimelineStartMs + CMTimeGetSeconds(sourceRange.duration) * 1_000
      )
      if CMTimeCompare(screenEnd, compositionDuration) < 0 {
        compositionVideoTrack.insertEmptyTimeRange(
          CMTimeRange(start: screenEnd, duration: CMTimeSubtract(compositionDuration, screenEnd))
        )
      }
    }

    let videoLayout = try await makeVideoComposition(
      sourceTrack: sourceVideoTrack,
      compositionTrack: compositionVideoTrack,
      clipStart: time(milliseconds: screenTimelineStartMs),
      clipDuration: screenClip == nil ? compositionDuration : sourceRange.duration,
      timelineDuration: compositionDuration,
      crop: configuration.crop,
      rotation: configuration.rotation,
      frameRate: configuration.frameRate,
      isVisible: screenIsVisible
    )
    let audioMix = try await addAudioTracks(
      from: asset,
      to: composition,
      fallbackSourceRange: fallbackSourceRange,
      trimStartMs: configuration.trimStartMs,
      mutedRanges: configuration.mutedRanges,
      project: project
    )

    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
      at: thumbnailURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    guard !FileManager.default.fileExists(atPath: outputURL.path),
          !FileManager.default.fileExists(atPath: thumbnailURL.path) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The editor output target already exists."
      )
    }

    do {
      let fileType: AVFileType = configuration.profileId == "master" ? .mov : .mp4
      let preset = try await exportPreset(
        for: configuration.profileId,
        composition: composition,
        outputFileType: fileType
      )
      guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
        throw NativeServiceError.encodingUnavailable(
          "The selected editor export profile is unavailable on this Mac."
        )
      }
      exporter.videoComposition = videoLayout.composition
      exporter.audioMix = audioMix
      exporter.shouldOptimizeForNetworkUse = configuration.profileId != "master"

      try await exporter.export(to: outputURL, as: fileType)

      let outputMetadata = try await inspectOutput(at: outputURL)

      // AVAssetImageGenerator may reject the exact end boundary, so keep the poster at least one
      // source frame inside the exported timeline.
      let outputDurationMs = CMTimeGetSeconds(compositionDuration) * 1_000
      let lastPosterTimeMs = max(0, outputDurationMs - (1_000 / Double(configuration.frameRate)))
      let posterTimelineMs = screenClip.map {
        $0.timelineStartMs + configuration.posterTimeMs - $0.sourceStartMs
      } ?? (configuration.posterTimeMs - configuration.trimStartMs)
      let posterRelativeMs = min(
        max(0, posterTimelineMs),
        lastPosterTimeMs
      )
      let thumbnailPath: String?
      do {
        thumbnailPath = try await createPosterFrame(
          recordingURL: outputURL,
          outputURL: thumbnailURL,
          timeMs: posterRelativeMs
        )
      } catch {
        // A failed poster must not discard an otherwise valid media export. Electron can lazily
        // create a fallback thumbnail from the completed recording.
        NativeLog.capture.warning("Editor poster generation failed; using lazy thumbnail fallback")
        thumbnailPath = nil
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: outputURL.path)
      let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0

      return NativeEditedRecordingResult(
        status: "completed",
        filePath: outputURL.path,
        thumbnailPath: thumbnailPath,
        profileId: outputMetadata.profileId,
        codec: outputMetadata.codec,
        width: Int(videoLayout.renderSize.width),
        height: Int(videoLayout.renderSize.height),
        frameRate: configuration.frameRate,
        durationMs: outputMetadata.durationMs,
        fileSizeBytes: fileSize,
        hasSystemAudio: outputMetadata.hasAudio && configuration.hasSystemAudio,
        hasMicrophone: outputMetadata.hasAudio && configuration.hasMicrophone
      )
    } catch {
      try? FileManager.default.removeItem(at: outputURL)
      try? FileManager.default.removeItem(at: thumbnailURL)
      if let serviceError = error as? NativeServiceError { throw serviceError }
      throw NativeServiceError.fileFinalizationFailed(
        "The edited recording could not be exported: \(error.localizedDescription)"
      )
    }
  }

  private func makeVideoComposition(
    sourceTrack: AVAssetTrack,
    compositionTrack: AVMutableCompositionTrack,
    clipStart: CMTime,
    clipDuration: CMTime,
    timelineDuration: CMTime,
    crop: NormalizedCropPayload,
    rotation: Int,
    frameRate: Int,
    isVisible: Bool
  ) async throws -> (composition: AVMutableVideoComposition, renderSize: CGSize) {
    let naturalSize = try await sourceTrack.load(.naturalSize)
    let preferredTransform = try await sourceTrack.load(.preferredTransform)
    let naturalRect = CGRect(origin: .zero, size: naturalSize)
    let orientedRect = naturalRect.applying(preferredTransform).standardized
    let orientedSize = orientedRect.size
    guard orientedSize.width >= 2, orientedSize.height >= 2 else {
      throw NativeServiceError.invalidConfiguration("The source video dimensions are invalid.")
    }

    let cropRect = pixelCrop(crop, within: orientedSize)
    var transform = preferredTransform
      .concatenating(
        CGAffineTransform(translationX: -orientedRect.minX, y: -orientedRect.minY)
      )
      .concatenating(CGAffineTransform(translationX: -cropRect.minX, y: -cropRect.minY))

    let rotationTransform = CGAffineTransform(
      rotationAngle: CGFloat(rotation) * .pi / 180
    )
    let rotatedBounds = CGRect(origin: .zero, size: cropRect.size)
      .applying(rotationTransform)
      .standardized
    transform = transform
      .concatenating(rotationTransform)
      .concatenating(
        CGAffineTransform(translationX: -rotatedBounds.minX, y: -rotatedBounds.minY)
      )

    let renderSize = CGSize(
      width: evenDimension(rotatedBounds.width),
      height: evenDimension(rotatedBounds.height)
    )
    var instructions: [AVMutableVideoCompositionInstruction] = []
    if CMTimeCompare(clipStart, .zero) > 0 {
      instructions.append(blackInstruction(start: .zero, duration: clipStart))
    }

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: clipStart, duration: clipDuration)
    instruction.backgroundColor = NSColor.black.cgColor
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionTrack)
    layerInstruction.setTransform(transform, at: clipStart)
    if !isVisible {
      layerInstruction.setOpacity(0, at: clipStart)
    }
    instruction.layerInstructions = [layerInstruction]
    instructions.append(instruction)

    let clipEnd = CMTimeAdd(clipStart, clipDuration)
    if CMTimeCompare(clipEnd, timelineDuration) < 0 {
      instructions.append(
        blackInstruction(start: clipEnd, duration: CMTimeSubtract(timelineDuration, clipEnd))
      )
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = instructions
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(frameRate))
    return (videoComposition, renderSize)
  }

  private func blackInstruction(
    start: CMTime,
    duration: CMTime
  ) -> AVMutableVideoCompositionInstruction {
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: start, duration: duration)
    instruction.backgroundColor = NSColor.black.cgColor
    instruction.layerInstructions = []
    return instruction
  }

  private func addAudioTracks(
    from asset: AVURLAsset,
    to composition: AVMutableComposition,
    fallbackSourceRange: CMTimeRange,
    trimStartMs: Double,
    mutedRanges: [MuteRangePayload],
    project: EditingProjectPayload?
  ) async throws -> AVMutableAudioMix? {
    let sourceTracks = try await asset.loadTracks(withMediaType: .audio)
    guard !sourceTracks.isEmpty else { return nil }
    let assetDuration = try await asset.load(.duration)
    let assetDurationMs = CMTimeGetSeconds(assetDuration) * 1_000

    var parameters: [AVMutableAudioMixInputParameters] = []
    for (sourceTrackIndex, sourceTrack) in sourceTracks.enumerated() {
      let lanes = project?.tracks.filter { track in
        ["microphone", "system-audio", "music"].contains(track.kind) &&
          track.clips.contains(where: { $0.sourceTrackIndex == sourceTrackIndex })
      }
      if project != nil && (lanes?.isEmpty ?? true) { continue }

      let clipSources: [(EditingTrackPayload?, CMTimeRange, Double)]
      if let lanes {
        clipSources = try lanes.flatMap { lane in
          try lane.clips
            .filter { $0.sourceTrackIndex == sourceTrackIndex }
            .map { clip in
              try validateSourceRange(
                startMs: clip.sourceStartMs,
                durationMs: clip.durationMs,
                sourceDurationMs: assetDurationMs
              )
              return (
                lane,
                CMTimeRange(
                  start: time(milliseconds: clip.sourceStartMs),
                  duration: time(milliseconds: clip.durationMs)
                ),
                clip.timelineStartMs
              )
            }
        }
      } else {
        clipSources = [(nil, fallbackSourceRange, 0)]
      }

      for (lane, clipSourceRange, timelineStartMs) in clipSources {
        guard let targetTrack = composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
          throw NativeServiceError.fileFinalizationFailed(
            "The editor could not create an audio track."
          )
        }
        let timelineStart = time(milliseconds: timelineStartMs)
        try targetTrack.insertTimeRange(clipSourceRange, of: sourceTrack, at: timelineStart)
        let inputParameters = AVMutableAudioMixInputParameters(track: targetTrack)
        let baseGain: Float = lane?.muted == true ? 0 : Float(lane?.gain ?? 1)
        let clipStartMs = timelineStartMs
        let clipEndMs = timelineStartMs + CMTimeGetSeconds(clipSourceRange.duration) * 1_000
        setConstantVolume(
          baseGain,
          fromMs: clipStartMs,
          toMs: clipEndMs,
          parameters: inputParameters
        )

        for range in mutedRanges {
          let muteStartMs = max(clipStartMs, range.startMs - (project == nil ? trimStartMs : 0))
          let muteEndMs = min(clipEndMs, range.endMs - (project == nil ? trimStartMs : 0))
          setConstantVolume(
            0,
            fromMs: muteStartMs,
            toMs: muteEndMs,
            parameters: inputParameters
          )
        }
        parameters.append(inputParameters)
      }
    }
    let mix = AVMutableAudioMix()
    mix.inputParameters = parameters
    return mix
  }

  private func setConstantVolume(
    _ volume: Float,
    fromMs: Double,
    toMs: Double,
    parameters: AVMutableAudioMixInputParameters
  ) {
    guard toMs > fromMs else { return }
    let start = time(milliseconds: fromMs)
    let end = time(milliseconds: toMs)
    parameters.setVolumeRamp(
      fromStartVolume: volume,
      toEndVolume: volume,
      timeRange: CMTimeRange(start: start, duration: CMTimeSubtract(end, start))
    )
  }

  private func exportPreset(
    for profileId: String,
    composition: AVMutableComposition,
    outputFileType: AVFileType
  ) async throws -> String {
    let requested = switch profileId {
    case "master": AVAssetExportPresetAppleProRes422LPCM
    case "balanced": AVAssetExportPresetHEVCHighestQuality
    default: AVAssetExportPresetHighestQuality
    }
    if await AVAssetExportSession.compatibility(
      ofExportPreset: requested,
      with: composition,
      outputFileType: outputFileType
    ) {
      return requested
    }
    if await AVAssetExportSession.compatibility(
      ofExportPreset: AVAssetExportPresetHighestQuality,
      with: composition,
      outputFileType: outputFileType
    ) {
      return AVAssetExportPresetHighestQuality
    }
    throw NativeServiceError.encodingUnavailable(
      "No compatible editor export preset is available for this recording."
    )
  }

  private func createPosterFrame(
    recordingURL: URL,
    outputURL: URL,
    timeMs: Double
  ) async throws -> String? {
    let asset = AVURLAsset(url: recordingURL)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 1280, height: 720)
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
    let result = try await generator.image(at: time(milliseconds: timeMs))
    let bitmap = NSBitmapImageRep(cgImage: result.image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { return nil }
    try data.write(to: outputURL, options: .atomic)
    return outputURL.path
  }

  private func inspectOutput(
    at outputURL: URL
  ) async throws -> (profileId: String, codec: String, durationMs: Double, hasAudio: Bool) {
    let outputAsset = AVURLAsset(url: outputURL)
    guard let videoTrack = try await outputAsset.loadTracks(withMediaType: .video).first else {
      throw NativeServiceError.fileFinalizationFailed(
        "The edited recording contains no readable video track."
      )
    }
    let formatDescriptions = try await videoTrack.load(.formatDescriptions)
    guard let description = formatDescriptions.first else {
      throw NativeServiceError.fileFinalizationFailed(
        "The edited recording codec could not be inspected."
      )
    }
    let mediaProfile = switch CMFormatDescriptionGetMediaSubType(description) {
    case kCMVideoCodecType_H264: (profileId: "compatible", codec: "h264")
    case kCMVideoCodecType_HEVC: (profileId: "balanced", codec: "hevc")
    case kCMVideoCodecType_AppleProRes422: (profileId: "master", codec: "prores422")
    default:
      throw NativeServiceError.encodingUnavailable(
        "The editor produced an unsupported output codec."
      )
    }
    let durationSeconds = CMTimeGetSeconds(try await outputAsset.load(.duration))
    guard durationSeconds.isFinite, durationSeconds > 0 else {
      throw NativeServiceError.fileFinalizationFailed(
        "The edited recording duration is invalid."
      )
    }
    let hasAudio = try await !outputAsset.loadTracks(withMediaType: .audio).isEmpty
    return (mediaProfile.profileId, mediaProfile.codec, durationSeconds * 1_000, hasAudio)
  }

  private func pixelCrop(_ crop: NormalizedCropPayload, within size: CGSize) -> CGRect {
    let x = floor(crop.x * size.width)
    let y = floor(crop.y * size.height)
    let availableWidth = max(2, size.width - x)
    let availableHeight = max(2, size.height - y)
    let width = min(availableWidth, evenDimension(crop.width * size.width))
    let height = min(availableHeight, evenDimension(crop.height * size.height))
    return CGRect(x: x, y: y, width: width, height: height)
  }

  private func evenDimension(_ value: CGFloat) -> CGFloat {
    max(2, floor(value / 2) * 2)
  }

  private func time(milliseconds: Double) -> CMTime {
    CMTime(seconds: max(0, milliseconds) / 1_000, preferredTimescale: 60_000)
  }

  private func validateSourceRange(
    startMs: Double,
    durationMs: Double,
    sourceDurationMs: Double
  ) throws {
    guard startMs.isFinite, durationMs.isFinite, startMs >= 0, durationMs > 0,
          startMs + durationMs <= sourceDurationMs + 1 else {
      throw NativeServiceError.invalidConfiguration(
        "An editing clip extends beyond its source recording."
      )
    }
  }
}

private struct RecordingEditConfiguration {
  let inputPath: String
  let outputPath: String
  let thumbnailPath: String
  let profileId: String
  let codec: String
  let frameRate: Int
  let hasSystemAudio: Bool
  let hasMicrophone: Bool
  let trimStartMs: Double
  let trimEndMs: Double
  let crop: NormalizedCropPayload
  let rotation: Int
  let mutedRanges: [MuteRangePayload]
  let posterTimeMs: Double
  let project: EditingProjectPayload?

  init(_ payload: RecordingEditPayload) throws {
    guard !payload.inputPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !payload.outputPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !payload.thumbnailPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NativeServiceError.invalidConfiguration("Editor file paths are required.")
    }
    let inputURL = URL(fileURLWithPath: payload.inputPath).standardizedFileURL
    let outputURL = URL(fileURLWithPath: payload.outputPath).standardizedFileURL
    let thumbnailURL = URL(fileURLWithPath: payload.thumbnailPath).standardizedFileURL
    guard inputURL != outputURL,
          inputURL != thumbnailURL,
          outputURL != thumbnailURL else {
      throw NativeServiceError.invalidConfiguration(
        "Editor input, output, and poster paths must be different."
      )
    }
    guard ["compatible", "balanced", "master"].contains(payload.profileId),
          ["h264", "hevc", "prores422"].contains(payload.codec),
          payload.frameRate == 30 || payload.frameRate == 60 else {
      throw NativeServiceError.invalidConfiguration("The editor media profile is unsupported.")
    }
    guard payload.trimStartMs.isFinite,
          payload.trimEndMs.isFinite,
          payload.trimStartMs >= 0,
          payload.trimEndMs - payload.trimStartMs >= 100,
          payload.posterTimeMs >= payload.trimStartMs,
          payload.posterTimeMs <= payload.trimEndMs else {
      throw NativeServiceError.invalidConfiguration("The editor timeline selection is invalid.")
    }
    guard [0, 90, 180, 270].contains(payload.rotation),
          payload.crop.x >= 0,
          payload.crop.y >= 0,
          payload.crop.width >= 0.02,
          payload.crop.height >= 0.02,
          payload.crop.x + payload.crop.width <= 1.000_001,
          payload.crop.y + payload.crop.height <= 1.000_001 else {
      throw NativeServiceError.invalidConfiguration("The editor crop or rotation is invalid.")
    }
    guard payload.mutedRanges.allSatisfy({ range in
      range.startMs >= (payload.project == nil ? payload.trimStartMs : 0) &&
        range.endMs <= (payload.project?.durationMs ?? payload.trimEndMs) &&
        range.endMs > range.startMs
    }) else {
      throw NativeServiceError.invalidConfiguration("An editor mute range is invalid.")
    }
    if let project = payload.project {
      let trackIDs = Set(project.tracks.map(\.id))
      guard project.schemaVersion == 1,
            !project.recordingId.isEmpty,
            !project.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            project.durationMs.isFinite && project.durationMs > 0,
            project.updatedAt.isFinite && project.updatedAt >= 0,
            project.tracks.count <= 64,
            !project.tracks.isEmpty,
            trackIDs.count == project.tracks.count,
            project.tracks.allSatisfy({ track in
              ["screen", "webcam", "microphone", "system-audio", "music", "captions", "overlays"]
                .contains(track.kind) &&
                !track.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                track.order >= 0 && track.clips.count <= 500 &&
                track.gain.isFinite && track.gain >= 0 && track.gain <= 4 &&
                track.clips.allSatisfy({ clip in
                  clip.sourceRecordingId == project.recordingId &&
                    (clip.sourceTrackIndex.map { $0 >= 0 } ?? true) &&
                    clip.sourceStartMs.isFinite && clip.sourceStartMs >= 0 &&
                    clip.durationMs.isFinite && clip.durationMs > 0 &&
                    clip.timelineStartMs.isFinite && clip.timelineStartMs >= 0 &&
                    (clip.timelineStartMs + clip.durationMs).isFinite &&
                    clip.timelineStartMs + clip.durationMs <= project.durationMs + 1
                })
            }) else {
        throw NativeServiceError.invalidConfiguration("The editing project timeline is invalid.")
      }
    }
    self.inputPath = payload.inputPath
    self.outputPath = payload.outputPath
    self.thumbnailPath = payload.thumbnailPath
    self.profileId = payload.profileId
    self.codec = payload.codec
    self.frameRate = payload.frameRate
    self.hasSystemAudio = payload.hasSystemAudio
    self.hasMicrophone = payload.hasMicrophone
    self.trimStartMs = payload.trimStartMs
    self.trimEndMs = payload.trimEndMs
    self.crop = payload.crop
    self.rotation = payload.rotation
    self.mutedRanges = payload.mutedRanges
    self.posterTimeMs = payload.posterTimeMs
    self.project = payload.project
  }
}
#endif
