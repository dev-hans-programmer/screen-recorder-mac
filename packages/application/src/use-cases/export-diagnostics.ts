import type { DiagnosticsReportPort } from '../ports/platform-ports';
import type { RecordingDiagnosticsRepository } from '../ports/repositories';

export class ExportDiagnosticsUseCase {
  public constructor(
    private readonly diagnostics: RecordingDiagnosticsRepository,
    private readonly reports: DiagnosticsReportPort,
  ) {}

  public async execute(): Promise<string | undefined> {
    return this.reports.exportReport(await this.diagnostics.listRecent(20));
  }
}
