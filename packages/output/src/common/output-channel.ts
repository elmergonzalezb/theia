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

import { injectable, inject, postConstruct } from 'inversify';
import * as PQueue from 'p-queue';
import { Emitter, Event, Disposable, DisposableCollection } from '@theia/core';
import { StorageService } from '@theia/core/lib/browser';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import { OutputPreferences } from './output-preferences';
import { CommandRegistry, CommandContribution } from '@theia/core/lib/common/command';
import { OutputCommands } from '../browser/output-contribution';
import { OutputConfigSchema } from './output-preferences';
import { OutputUri } from './output-uri';
import URI from '@theia/core/lib/common/uri';
import { OutputResource } from '../browser/output-resource';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';

@injectable()
export class OutputChannelManager implements CommandContribution, Disposable, ResourceResolver {

    @inject(OutputPreferences)
    protected readonly preferences: OutputPreferences;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    @inject(MonacoTextModelService)
    protected readonly textModelService: MonacoTextModelService;

    protected readonly channels = new Map<string, OutputChannel>();
    protected readonly resources = new Map<string, OutputResource>();
    protected _selectedChannel?: OutputChannel | undefined;

    protected readonly channelAddedEmitter = new Emitter<{ name: string }>();
    protected readonly channelDeletedEmitter = new Emitter<{ name: string }>();
    protected readonly selectedChannelChangedEmitter = new Emitter<{ name?: string }>();

    readonly onChannelAdded = this.channelAddedEmitter.event;
    readonly onChannelDeleted = this.channelDeletedEmitter.event;
    readonly onSelectedChannelChanged = this.selectedChannelChangedEmitter.event;

    protected toDispose = new DisposableCollection();
    protected toDisposeOnChannelDeletion = new Map<string, DisposableCollection>();

    @postConstruct()
    protected init(): void {
        this.toDispose.pushAll([
            this.channelAddedEmitter,
            this.channelDeletedEmitter,
            this.selectedChannelChangedEmitter,
            this.onChannelAdded(({ name }) => this.registerListener(this.getChannel(name)),
                this.onChannelDeleted(({ name }) => {
                    if (this.selectedChannel && this.selectedChannel.name === name) {
                        this.selectedChannel = this.getVisibleChannels()[0];
                    }
                }))
        ]);
        this.getChannels().forEach(this.registerListener.bind(this));
    }

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
    }

    protected registerListener(outputChannel: OutputChannel): void {
        const { name } = outputChannel;
        if (!this.selectedChannel) {
            this.selectedChannel = outputChannel;
        }
        let toDispose = this.toDisposeOnChannelDeletion.get(name);
        if (!toDispose) {
            toDispose = new DisposableCollection();
            this.toDisposeOnChannelDeletion.set(name, toDispose);
        }
        toDispose.pushAll([
            outputChannel,
            outputChannel.onVisibilityChange(event => {
                if (event.visible) {
                    this.selectedChannel = outputChannel;
                } else if (outputChannel === this.selectedChannel) {
                    this.selectedChannel = this.getVisibleChannels()[0];
                }
            }),
            Disposable.create(() => {
                const uri = outputChannel.uri.toString();
                const resource = this.resources.get(uri);
                if (resource) {
                    resource.dispose();
                    this.resources.delete(uri);
                } else {
                    console.warn(`Could not dispose. No resource was registered with URI: ${uri}.`);
                }
            })
        ]);
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
        this.channelAddedEmitter.fire(channel);
        return channel;
    }

    deleteChannel(name: string): void {
        const existing = this.channels.get(name);
        if (!existing) {
            console.warn(`Could not delete channel '${name}'. The channel does not exist.`);
            return;
        }
        this.channels.delete(name);
        const toDispose = this.toDisposeOnChannelDeletion.get(name);
        if (toDispose) {
            toDispose.dispose();
        }
        this.channelDeletedEmitter.fire({ name });
    }

    getChannels(): OutputChannel[] {
        return Array.from(this.channels.values());
    }

    getVisibleChannels(): OutputChannel[] {
        return this.getChannels().filter(channel => channel.isVisible);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    get selectedChannel(): OutputChannel | undefined {
        return this._selectedChannel;
    }

    set selectedChannel(channel: OutputChannel | undefined) {
        this._selectedChannel = channel;
        const name = this._selectedChannel ? this._selectedChannel.name : undefined;
        this.selectedChannelChangedEmitter.fire({ name });
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

    private readonly visibilityChangeEmitter = new Emitter<{ visible: boolean }>();
    private readonly contentChangeEmitter = new Emitter<void>();
    private readonly toDispose = new DisposableCollection(
        this.visibilityChangeEmitter,
        this.contentChangeEmitter
    );

    private visible = true;
    private _maxLineNumber: number;
    private decorationIds = new Set<string>();
    private textModifyQueue = new PQueue({ autoStart: true, concurrency: 1 });

    readonly onVisibilityChange: Event<{ visible: boolean }> = this.visibilityChangeEmitter.event;
    readonly onContentChange: Event<void> = this.contentChangeEmitter.event;

    constructor(protected readonly resource: OutputResource, protected readonly preferences: OutputPreferences) {
        this._maxLineNumber = this.preferences['output.maxChannelHistory'];
        this.toDispose.push(this.preferences.onPreferenceChanged(({ preferenceName, newValue }) => {
            if (preferenceName === 'output.maxChannelHistory') {
                const maxLineNumber = newValue ? newValue : OutputConfigSchema.properties['output.maxChannelHistory'].default;
                if (this.maxLineNumber !== maxLineNumber) {
                    this.maxLineNumber = maxLineNumber;
                }
            }
        }));
        this.toDispose.push(Disposable.create(() => this.decorationIds.clear())); // TODO: check is `deltaDecoration` with empty [] is required.
    }

    protected get maxLineNumber(): number {
        return this._maxLineNumber;
    }

    protected set maxLineNumber(maxLineNumber: number) {
        this._maxLineNumber = maxLineNumber;
        this.append(''); // to trigger `ensureMaxChannelHistory`.
    }

    get name(): string {
        return OutputUri.channelName(this.uri);
    }

    get uri(): URI {
        return this.resource.uri;
    }

    append(content: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.textModifyQueue.add(() => this.doAppend({ content, severity }));
    }

    appendLine(content: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.textModifyQueue.add(() => this.doAppend({ content, severity, eol: true }));
    }

    protected async doAppend({ content, severity, eol }: { content: string, severity: OutputChannelSeverity, eol?: boolean }): Promise<void> {
        const textModel = (await this.resource.editorModel.promise).textEditorModel;
        const lastLine = textModel.getLineCount();
        const lastLineMaxColumn = textModel.getLineMaxColumn(lastLine);
        const position = new monaco.Position(lastLine, lastLineMaxColumn);
        const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
        const edits = [{
            range,
            text: !!eol ? `${content}${textModel.getEOL()}` : content,
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
                .filter(({ id }) => this.decorationIds.has(id)).map(({ id }) => id); // Do we need to filter here? Who else can put decoration to the model? Maybe Text-Mate later?
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

    clear(): void {
        this.textModifyQueue.add(() => this.doClear());
    }

    protected async doClear(): Promise<void> {
        const textModel = (await this.resource.editorModel.promise).textEditorModel;
        textModel.deltaDecorations(Array.from(this.decorationIds), []);
        this.decorationIds.clear();
        textModel.setValue('');
        this.contentChangeEmitter.fire();
    }

    setVisibility(visible: boolean): void {
        this.visible = visible;
        this.visibilityChangeEmitter.fire({ visible });
    }

    get isVisible(): boolean {
        return this.visible;
    }

    dispose(): void {
        this.toDispose.dispose();
    }

}
