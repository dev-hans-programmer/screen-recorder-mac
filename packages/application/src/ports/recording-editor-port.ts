import type {
  RecordingArtifact,
  RecordingEditPlan,
  RecordingMetadata,
} from '@screen-recorder/domain';

export interface RecordingEditorExportRequest {
  readonly source: RecordingMetadata;
  readonly plan: RecordingEditPlan;
  readonly outputId: string;
  readonly createdAt: number;
}

export interface RecordingEditorExportResult {
  readonly artifact: RecordingArtifact;
  readonly thumbnailPath: string | undefined;
}

export interface RecordingEditorPort {
  exportRecording(request: RecordingEditorExportRequest): Promise<RecordingEditorExportResult>;
}
