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
import { Emitter, Event, Disposable, DisposableCollection } from '@theia/core';
import { StorageService } from '@theia/core/lib/browser';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import { OutputPreferences } from './output-preferences';
import { CommandRegistry, CommandContribution } from '@theia/core/lib/common/command';
import { OutputCommands } from '../browser/output-contribution';
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
        registry.registerCommand(OutputCommands.SHOW, {
            execute: ({ name, options }: { name: string, options?: { preserveFocus?: boolean } }) => {
                if (name) {
                    // TODO: Does this belong here or should go to the UI? Probably the latter.
                }
            }
        });
        registry.registerCommand(OutputCommands.HIDE, {
            execute: ({ name }: { name: string }) => {
                if (name) {
                    // TODO: same as for `show`. Figure out whether creating a new channel if does not exist is a good strategy or not.
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

        const uri = OutputUri.create(name);
        let resource = this.resources.get(uri.toString());
        if (!resource) {
            const editorModel = new Deferred<MonacoEditorModel>();
            resource = new OutputResource(uri, editorModel);
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

}

export enum OutputChannelSeverity {
    Error = 1,
    Warning = 2,
    Info = 3
}

export class OutputChannel implements Disposable {

    private readonly visibilityChangeEmitter = new Emitter<{ visible: boolean }>();
    private readonly contentChangeEmitter = new Emitter<{ text: string }>();
    private readonly toDispose = new DisposableCollection(
        this.visibilityChangeEmitter,
        this.contentChangeEmitter
    );

    private visible = true;

    readonly onVisibilityChange: Event<{ visible: boolean }> = this.visibilityChangeEmitter.event;
    readonly onContentChange: Event<{ text: string }> = this.contentChangeEmitter.event;

    constructor(protected readonly resource: OutputResource, protected readonly preferences: OutputPreferences) {
        setTimeout(() => {
            this.model.then(textEditorModel => {
                this.toDispose.pushAll([
                    textEditorModel.onDidChangeContent(event => {
                        if (event.changes.length > 1) {
                            throw new Error('TODO: decide about the delta structure. can we expose IModelContentChangedEvent as-is?');
                        }
                        const { text } = event.changes[0];
                        this.contentChangeEmitter.fire({ text });
                    })
                ]);
            });
        });
    }

    get name(): string {
        return OutputUri.channelName(this.uri);
    }

    get uri(): URI {
        return this.resource.uri;
    }

    protected get model(): Promise<monaco.editor.ITextModel> {
        return new Promise<monaco.editor.ITextModel>(resolve => this.resource.editorModel.promise.then(({ textEditorModel }) => resolve(textEditorModel)));
    }

    append(text: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.model.then(textEditorModel => {
            const line = textEditorModel.getLineCount();
            const column = textEditorModel.getLineMaxColumn(line);
            const range = new monaco.Range(line, column, line, column);
            // TODO: use `pushEditOperations` instead? Do we need undo/redo support?
            // TODO: check if cursor position can be handled with the `textModel` only.
            textEditorModel.applyEdits([
                {
                    range,
                    text
                }
            ]);
            if (severity !== OutputChannelSeverity.Info) {
                const inlineClassName = severity === OutputChannelSeverity.Error ? 'theia-output-error' : 'theia-output-warning';
                const endLineNumber = textEditorModel.getLineCount();
                const endColumn = textEditorModel.getLineMaxColumn(endLineNumber);
                textEditorModel.deltaDecorations([], [{
                    range: new monaco.Range(range.startLineNumber, range.startColumn, endLineNumber, endColumn), options: {
                        inlineClassName
                    }
                }]);
            }
        });
    }

    appendLine(line: string, severity: OutputChannelSeverity = OutputChannelSeverity.Info): void {
        this.model.then(textEditorModel => this.append(`${line}${textEditorModel.getEOL()}`, severity));
        // TODO: do not forget this! Maybe, we can remove text form the start of the model to support clipping.
        // const maxChannelHistory = this.preferences['output.maxChannelHistory'];
        // if (this.lines.length > maxChannelHistory) {
        //     this.lines.splice(0, this.lines.length - maxChannelHistory);
        // }
    }

    clear(): void {
        this.model.then(textEditorModel => textEditorModel.setValue(''));
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
