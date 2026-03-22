import * as vscode from 'vscode';
import { AiAssistantPanel } from './aiAssistant';
import { registerHoverProvider } from './hoverProvider';

export function activate(context: vscode.ExtensionContext): void {
  registerHoverProvider(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('vinculum.askAI', () => {
      AiAssistantPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand('vinculum.clearDocCache', async () => {
      await AiAssistantPanel.clearDocCache(context);
      vscode.window.showInformationMessage('Vinculum: Documentation cache cleared.');
    }),
  );
}

export function deactivate(): void {}
