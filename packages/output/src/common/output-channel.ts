/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as PQueue from 'p-queue';
import { injectable, inject } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Emitter, Event, Disposable, DisposableCollection } from '@theia/core';
import { CommandRegistry, CommandContribution } from '@theia/core/lib/common/command';
import { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import { OpenerService, open, QuickPickService } from '@theia/core/lib/browser';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { OutputUri } from './output-uri';
import { OutputCommands } from '../browser/output-contribution';
import { OutputResource } from '../browser/output-resource';
import { OutputPreferences } from './output-preferences';
import { OutputConfigSchema } from './output-preferences';
import { QuickPickItem } from '@theia/core/src/common/quick-pick-service';

@injectable()
export class OutputChannelManager implements CommandContribution, Disposable, ResourceResolver {

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(MonacoTextModelService)
    protected readonly textModelService: MonacoTextModelService;

    @inject(OutputPreferences)
    protected readonly preferences: OutputPreferences;

    protected readonly channels = new Map<string, OutputChannel>();
    protected readonly resources = new Map<string, OutputResource>(); // TODO: store the channel `name` as the keys instead of URIs.
    protected _selectedChannel: OutputChannel | undefined;

    protected readonly channelAddedEmitter = new Emitter<{ name: string }>();
    protected readonly channelDeletedEmitter = new Emitter<{ name: string }>();
    protected readonly channelWasShownEmitter = new Emitter<{ name: string }>();
    protected readonly channelWasHiddenEmitter = new Emitter<{ name: string }>();
    protected readonly selectedChannelChangedEmitter = new Emitter<{ name: string } | undefined>();

    readonly onChannelAdded = this.channelAddedEmitter.event;
    readonly onChannelDeleted = this.channelDeletedEmitter.event;
    readonly onChannelWasShown = this.channelWasShownEmitter.event;
    readonly onChannelWasHidden = this.channelWasHiddenEmitter.event;
    readonly onSelectedChannelChanged = this.selectedChannelChangedEmitter.event;

    protected readonly toDispose = new DisposableCollection();
    protected readonly toDisposeOnChannelDeletion = new Map<string, Disposable>();

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(OutputCommands.APPEND, {
            execute: ({ name, text }: { name: string, text: string }) => {
                if (name && text) {
                    this.getChannel(name).append(text);
                }
            }
        });
        registry.registerCommand(OutputCommands.APPEND_LINE, {
            execute: ({ name, text }: { name: string, text: string }) => {
                if (name && text) {
                    this.getChannel(name).appendLine(text);
                }
            }
        });
        registry.registerCommand(OutputCommands.CLEAR, {
            execute: ({ name }: { name: string }) => {
                if (name) {
                    this.getChannel(name).clear();
                }
            }
        });
        registry.registerCommand(OutputCommands.DISPOSE, {
            execute: ({ name }: { name: string }) => {
                if (name) {
                    this.deleteChannel(name);
                }
            }
        });
        registry.registerCommand(OutputCommands.SHOW, {
            execute: ({ name, options }: { name: string, options?: { preserveFocus?: boolean } }) => {
                if (name) {
                    // Not just show on the UI but make sure the visible flag was flipped.
                    this.getChannel(name).show();
                    const preserveFocus = options && !!options.preserveFocus;
                    const activate = !preserveFocus;
                    const reveal = preserveFocus;
                    open(this.openerService, OutputUri.create(name), { activate, reveal });
                }
            }
        });
        registry.registerCommand(OutputCommands.HIDE, {
            execute: ({ name }: { name: string }) => {
                if (name) {
                    this.getChannel(name).hide();
                }
            }
        });

        registry.registerCommand(OutputCommands.CLEAR__QUICK_PICK, {
            execute: async () => {
                const channel = await this.pick({
                    placeholder: 'Clear output channel.',
                    channels: this.getChannels().slice()
                });
                if (channel) {
                    channel.clear();
                }
            },
            isEnabled: () => !!this.getChannels().length,
            isVisible: () => !!this.getChannels().length
        });
        registry.registerCommand(OutputCommands.SHOW__QUICK_PICK, {
            execute: async () => {
                const channel = await this.pick({
                    placeholder: 'Show output channel.',
                    channels: this.getChannels().slice()
                });
                if (channel) {
                    const { name } = channel;
                    registry.executeCommand(OutputCommands.SHOW.id, { name, options: { preserveFocus: true } });
                }
            },
            isEnabled: () => !!this.getChannels().length,
            isVisible: () => !!this.getChannels().length
        });
        registry.registerCommand(OutputCommands.HIDE__QUICK_PICK, {
            execute: async () => {
                const channel = await this.pick({
                    placeholder: 'Hide output channel.',
                    channels: this.getVisibleChannels().slice()
                });
                if (channel) {
                    const { name } = channel;
                    registry.executeCommand(OutputCommands.HIDE.id, { name });
                }
            },
            isEnabled: () => !!this.getVisibleChannels().length,
            isVisible: () => !!this.getVisibleChannels().length
        });
        registry.registerCommand(OutputCommands.DISPOSE__QUICK_PICK, {
            execute: async () => {
                const channel = await this.pick({
                    placeholder: 'Close output channel.',
                    channels: this.getChannels().slice()
                });
                if (channel) {
                    const { name } = channel;
                    registry.executeCommand(OutputCommands.DISPOSE.id, { name });
                }
            },
            isEnabled: () => !!this.getChannels().length,
            isVisible: () => !!this.getChannels().length
        });
    }

    protected async pick({ channels, placeholder }: { channels: OutputChannel[], placeholder: string }): Promise<OutputChannel | undefined> {
        const items: QuickPickItem<OutputChannel>[] = [];
        for (let i = 0; i < channels.length; i++) {
            const channel = channels[i];
            if (i === 0) {
                items.push({ label: channel.isVisible ? 'Output Channels' : 'Hidden Channels', type: 'separator' });
            } else if (!channel.isVisible && channels[i - 1].isVisible) {
                items.push({ label: 'Hidden Channels', type: 'separator' });
            }
            items.push({ label: channel.name, value: channel });
        }
        return this.quickPickService.show(items, { placeholder });
    }

    getChannel(name: string): OutputChannel {
        const existing = this.channels.get(name);
        if (existing) {
            return existing;
        }

        // We have to register the resource first, because `textModelService#createModelReference` will require it
        // right after creating the monaco.editor.ITextModel.
        // All `append` and `appendLine` will be deferred until the underlying text-model instantiation.
        const uri = OutputUri.create(name);
        let resource = this.resources.get(uri.toString());
        if (!resource) {
            const editorModel = new Deferred<MonacoEditorModel>();
            resource = this.createResource({ uri, editorModel });
            this.resources.set(uri.toString(), resource);
            this.textModelService.createModelReference(uri).then(({ object }) => editorModel.resolve(object));
        }

        const channel = new OutputChannel(resource, this.preferences);
        this.channels.set(name, channel);
        this.toDisposeOnChannelDeletion.set(name, this.registerListeners(channel));
        this.channelAddedEmitter.fire(channel);
        if (!this.selectedChannel) {
            this.selectedChannel = channel;
        }
        return channel;
    }

    protected registerListeners(channel: OutputChannel): Disposable {
        const { name } = channel;
        return new DisposableCollection(
            channel,
            channel.onVisibilityChange(({ isVisible }) => {
                if (isVisible) {
                    this.selectedChannel = channel;
                    this.channelWasShownEmitter.fire({ name });
                } else {
                    if (channel === this.selectedChannel) {
                        this.selectedChannel = this.getVisibleChannels()[0];
                    }
                    this.channelWasHiddenEmitter.fire({ name });
                }
            }),
            channel.onDisposed(() => this.deleteChannel(name)),
            Disposable.create(() => {
                const uri = channel.uri.toString();
                const resource = this.resources.get(uri);
                if (resource) {
                    resource.dispose();
                    this.resources.delete(uri);
                } else {
                    console.warn(`Could not dispose. No resource was registered with URI: ${uri}.`);
                }
            }),
            Disposable.create(() => {
                const toDispose = this.channels.get(name);
                if (!toDispose) {
                    console.warn(`Could not dispose. No channel exist with name: '${name}'.`);
                    return;
                }
                this.channels.delete(name);
                toDispose.dispose();
                this.channelDeletedEmitter.fire({ name });
                if (this.selectedChannel && this.selectedChannel.name === name) {
                    this.selectedChannel = this.getVisibleChannels()[0];
                }
            })
        );
    }

    deleteChannel(name: string): void {
        const toDispose = this.toDisposeOnChannelDeletion.get(name);
        if (toDispose) {
            toDispose.dispose();
        }
    }

    getChannels(): OutputChannel[] {
        return Array.from(this.channels.values()).sort(this.channelComparator);
    }

    getVisibleChannels(): OutputChannel[] {
        return this.getChannels().filter(channel => channel.isVisible);
    }

    protected get channelComparator(): (left: OutputChannel, right: OutputChannel) => number {
        return (left, right) => {
            if (left.isVisible !== right.isVisible) {
                return left.isVisible ? -1 : 1;
            }
            return left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase());
        };
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    get selectedChannel(): OutputChannel | undefined {
        return this._selectedChannel;
    }

    set selectedChannel(channel: OutputChannel | undefined) {
        this._selectedChannel = channel;
        if (this._selectedChannel) {
            this.selectedChannelChangedEmitter.fire({ name: this._selectedChannel.name });
        } else {
            this.selectedChannelChangedEmitter.fire(undefined);
        }
    }

    /**
     * Non-API: do not call directly.
     */
    async resolve(uri: URI): Promise<Resource> {
        if (!OutputUri.is(uri)) {
            throw new Error(`Expected '${OutputUri.SCHEME}' URI scheme. Got: ${uri} instead.`);
        }
        const resource = this.resources.get(uri.toString());
        if (!resource) {
            throw new Error(`No output resource was registered with URI: ${uri.toString()}`);
        }
        return resource;
    }

    protected createResource({ uri, editorModel }: { uri: URI, editorModel: Deferred<MonacoEditorModel> }): OutputResource {
        return new OutputResource(uri, editorModel);
    }

}

export enum OutputChannelSeverity {
    Error = 1,
    Warning = 2,
    Info = 3
}

export class OutputChannel implements Disposable {

    private readonly contentChangeEmitter = new Emitter<void>();
    private readonly visibilityChangeEmitter = new Emitter<{ isVisible: boolean }>();
    private readonly disposedEmitter = new Emitter<void>();
    private readonly toDispose = new DisposableCollection(
        this.contentChangeEmitter,
        this.visibilityChangeEmitter,
        this.disposedEmitter
    );

    private disposed = false;
    private visible = true;
    private _maxLineNumber: number;
    private decorationIds = new Set<string>();
    private textModifyQueue = new PQueue({ autoStart: true, concurrency: 1 });

    readonly onVisibilityChange: Event<{ isVisible: boolean }> = this.visibilityChangeEmitter.event;
    readonly onContentChange: Event<void> = this.contentChangeEmitter.event;
    readonly onDisposed: Event<void> = this.disposedEmitter.event;

    constructor(protected readonly resource: OutputResource, protected readonly preferences: OutputPreferences) {
        this._maxLineNumber = this.preferences['output.maxChannelHistory'];
        this.toDispose.push(resource);
        this.toDispose.push(Disposable.create(() => this.decorationIds.clear()));
        this.toDispose.push(this.preferences.onPreferenceChanged(({ preferenceName, newValue }) => {
            if (preferenceName === 'output.maxChannelHistory') {
                const maxLineNumber = newValue ? newValue : OutputConfigSchema.properties['output.maxChannelHistory'].default;
                if (this.maxLineNumber !== maxLineNumber) {
                    this.maxLineNumber = maxLineNumber;
                }
            }
        }));
    }

    get name(): string {
        return OutputUri.channelName(this.uri);
    }

    get uri(): URI {
        return this.resource.uri;
    }

    hide(): void {
        this.setVisibility(false);
    }

    show(): void {
        this.setVisibility(true);
    }

    /**
     * @deprecated use `show` and `hide` instead.
     *
     * TODO: decide on deprecation. I would be OK with a `setVisible(boolean)` signature, but not "visibility". So it would be a breaking anyway.
     * Also, `hide`/`show` is in sync with VS Code API. Thoughts?
     */
    setVisibility(visible: boolean): void {
        this.visible = visible;
        this.visibilityChangeEmitter.fire({ isVisible: this.isVisible });
    }

    /**
     * Note: if `false` it does not meant it is disposed or not available, it is only hidden from the UI.
     */
    get isVisible(): boolean {
        return this.visible;
    }

    clear(): void {
        this.textModifyQueue.add(async () => {
            const textModel = (await this.resource.editorModel.promise).textEditorModel;
            textModel.deltaDecorations(Array.from(this.decorationIds), []);
            this.decorationIds.clear();
            textModel.setValue('');
            this.contentChangeEmitter.fire();
        });
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.toDispose.dispose();
        this.disposedEmitter.fire();
    }

    append(content: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.textModifyQueue.add(() => this.doAppend({ content, severity }));
    }

    appendLine(content: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.textModifyQueue.add(() => this.doAppend({ content, severity, appendEol: true }));
    }

    protected async doAppend({ content, severity, appendEol }: { content: string, severity: OutputChannelSeverity, appendEol?: boolean }): Promise<void> {
        const textModel = (await this.resource.editorModel.promise).textEditorModel;
        const lastLine = textModel.getLineCount();
        const lastLineMaxColumn = textModel.getLineMaxColumn(lastLine);
        const position = new monaco.Position(lastLine, lastLineMaxColumn);
        const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
        const edits = [{
            range,
            text: !!appendEol ? `${content}${textModel.getEOL()}` : content,
            forceMoveMarkers: true
        }];
        // We do not use `pushEditOperations` as we do not need undo/redo support. VS Code uses `applyEdits` too.
        // https://github.com/microsoft/vscode/blob/dc348340fd1a6c583cb63a1e7e6b4fd657e01e01/src/vs/workbench/services/output/common/outputChannelModel.ts#L108-L115
        textModel.applyEdits(edits);
        if (severity !== OutputChannelSeverity.Info) {
            const inlineClassName = severity === OutputChannelSeverity.Error ? 'theia-output-error' : 'theia-output-warning';
            let endLineNumber = textModel.getLineCount();
            // If last line is empty (the first non-whitespace is 0), apply decorator to previous line's last non-whitespace instead
            // Note: if the user appends `inlineWarning `, the new decorator's range includes the trailing whitespace.
            if (!textModel.getLineFirstNonWhitespaceColumn(endLineNumber)) {
                endLineNumber--;
            }
            const endColumn = textModel.getLineLastNonWhitespaceColumn(endLineNumber);
            const newDecorations = [{
                range: new monaco.Range(range.startLineNumber, range.startColumn, endLineNumber, endColumn), options: {
                    inlineClassName
                }
            }];
            for (const decorationId of textModel.deltaDecorations([], newDecorations)) {
                this.decorationIds.add(decorationId);
            }
        }
        this.ensureMaxChannelHistory(textModel);
        this.contentChangeEmitter.fire();
    }

    protected ensureMaxChannelHistory(textModel: monaco.editor.ITextModel): void {
        this.contentChangeEmitter.fire();
        const linesToRemove = textModel.getLineCount() - this.maxLineNumber - 1; // -1 as the last line is usually empty -> `appendLine`.
        if (linesToRemove > 0) {
            const endColumn = textModel.getLineMaxColumn(linesToRemove);
            // `endLineNumber` is `linesToRemove` + 1 as monaco is one based.
            const range = new monaco.Range(1, 1, linesToRemove, endColumn + 1);
            // eslint-disable-next-line no-null/no-null
            const text = null;
            const decorationsToRemove = textModel.getLinesDecorations(range.startLineNumber, range.endLineNumber)
                .filter(({ id }) => this.decorationIds.has(id)).map(({ id }) => id); // Do we need to filter here? Who else can put decorations to the output model?
            if (decorationsToRemove.length) {
                for (const newId of textModel.deltaDecorations(decorationsToRemove, [])) {
                    this.decorationIds.add(newId);
                }
                for (const toRemoveId of decorationsToRemove) {
                    this.decorationIds.delete(toRemoveId);
                }
            }
            textModel.applyEdits([
                {
                    range: new monaco.Range(1, 1, linesToRemove + 1, textModel.getLineFirstNonWhitespaceColumn(linesToRemove + 1)),
                    text,
                    forceMoveMarkers: true
                }
            ]);
        }
    }

    protected get maxLineNumber(): number {
        return this._maxLineNumber;
    }

    protected set maxLineNumber(maxLineNumber: number) {
        this._maxLineNumber = maxLineNumber;
        this.append(''); // will trigger an `ensureMaxChannelHistory` call and will refresh the content.
    }

}
