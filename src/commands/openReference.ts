import * as vscode from 'vscode';
import * as path from 'path';

export class OpenReferenceCommand {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async execute(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    // Try workspace-local reference first, fall back to extension-bundled
    const workspaceRef = vscode.Uri.joinPath(
      workspaceFolder.uri,
      '.kiro',
      'steering',
      'amadeus-aidlc-reference.md'
    );

    const bundledRef = vscode.Uri.file(
      path.join(this.context.extensionPath, 'resources', 'amadeus-aidlc-reference.md')
    );

    let targetUri: vscode.Uri;

    try {
      await vscode.workspace.fs.stat(workspaceRef);
      targetUri = workspaceRef;
    } catch {
      try {
        await vscode.workspace.fs.stat(bundledRef);
        targetUri = bundledRef;
      } catch {
        vscode.window.showErrorMessage(
          'AIDLC reference file not found. Run "AIDLC Studio: Set Up" first.'
        );
        return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }
}
