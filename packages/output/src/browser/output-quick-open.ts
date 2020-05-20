/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
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

import { inject, injectable } from 'inversify';
import { OpenerService, open } from '@theia/core/lib/browser';
import { Command, CommandRegistry, CommandContribution } from '@theia/core/lib/common/command';
import { QuickOpenItem, QuickOpenModel, QuickOpenGroupItem } from '@theia/core/lib/common/quick-open-model';
import {
    QuickOpenService,
    QuickOpenOptions,
    QuickOpenItemOptions,
    QuickOpenContribution,
    QuickOpenActionProvider,
    QuickOpenHandlerRegistry,
    QuickOpenGroupItemOptions
} from '@theia/core/lib/browser/quick-open';
import { OutputChannelManager, OutputChannel } from '../common/output-channel';

@injectable()
export class OutputQuickOpenService implements QuickOpenContribution, QuickOpenModel, CommandContribution {

    readonly description = 'Quick Open';

    @inject(QuickOpenService)
    protected readonly quickOpenService: QuickOpenService;

    @inject(OutputChannelManager)
    protected readonly channelManager: OutputChannelManager;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    protected operation = OutputQuickOpenService.Operation.DEFAULT;

    registerCommands(registry: CommandRegistry): void {
        const hasChannels = () => !!this.channelManager.getChannels().length;
        const hasVisibleChannels = () => !!this.channelManager.getChannels().filter(({ isVisible }) => isVisible);

        registry.registerCommand(OutputQuickOpenService.Commands.CLEAR, {
            execute: async () => {
                const channel = await this.pick(OutputQuickOpenService.Operation.CLEAR);
                if (channel) {
                    channel.clear();
                }
            },
            isEnabled: hasChannels.bind(this),
            isVisible: hasChannels.bind(this),
        });
        registry.registerCommand(OutputQuickOpenService.Commands.SHOW, {
            execute: async () => {
                const channel = await this.pick(OutputQuickOpenService.Operation.SHOW);
                if (channel) {
                    open(this.openerService, channel.uri, { activate: true, reveal: true });
                }
            },
            isEnabled: hasChannels.bind(this),
            isVisible: hasChannels.bind(this),
        });
        registry.registerCommand(OutputQuickOpenService.Commands.HIDE, {
            execute: async () => {
                const channel = await this.pick(OutputQuickOpenService.Operation.HIDE);
                if (channel) {
                    channel.setVisibility(false);
                }
            },
            isEnabled: hasVisibleChannels.bind(this),
            isVisible: hasVisibleChannels.bind(this)
        });
        registry.registerCommand(OutputQuickOpenService.Commands.DISPOSE, {
            execute: async () => {
                const channel = await this.pick(OutputQuickOpenService.Operation.DISPOSE);
                if (channel) {
                    channel.dispose();
                }
            },
            isEnabled: hasChannels.bind(this),
            isVisible: hasChannels.bind(this),
        });
    }

    registerQuickOpenHandlers(registry: QuickOpenHandlerRegistry): void {
        registry.registerHandler({ ...this, prefix: '' });
    }

    getModel(): QuickOpenModel {
        return this;
    }

    getOptions(): QuickOpenOptions {
        return {
            fuzzyMatchLabel: {
                enableSeparateSubstringMatching: true,
            },
            onClose: () => {
                this.operation = OutputQuickOpenService.Operation.DEFAULT
            },
            placeholder: `Select an output channel${this.operation.name ? ` to ${this.operation.name}` : ''}. Press 'Enter' to confirm or 'Escape' to cancel.`
        };
    }

    onType(
        lookFor: string,
        acceptor: (items: QuickOpenItem<QuickOpenItemOptions>[], actionProvider?: QuickOpenActionProvider) => void): void {

        const toAccept: QuickOpenItem<QuickOpenItemOptions>[] = [];
        // for (const [groupLabel, items] of this.channelManager.getChannels().filter(this.op)) {
        //     toAccept.push(...items.map((item, i) => {
        //         let group: QuickOpenGroupItemOptions | undefined = undefined;
        //         if (i === 0) {
        //             group = { groupLabel, showBorder: toAccept.length > 0 };
        //         }
        //         return this.toQuickItem(item, group);
        //     }));
        // }
        acceptor(toAccept);
    }

    protected async pick(operation: OutputQuickOpenService.Operation): Promise<OutputChannel | undefined> {
        this.operation = operation;
        this.quickOpenService.open(this, this.getOptions());
    }

    protected toQuickItem(label: string, group?: QuickOpenGroupItemOptions): QuickOpenItem<QuickOpenItemOptions> {
        const options = { label };
        if (group) {
            return new QuickOpenGroupItem<QuickOpenGroupItemOptions>({ ...options, ...group });
        } else {
            return new QuickOpenItem<QuickOpenItemOptions>(options);
        }
    }

}

export namespace OutputQuickOpenService {

    export namespace Commands {

        export const category = 'Output Channel';

        export const CLEAR: Command = {
            id: 'output:pick-clear',
            label: 'Clear Output Channel...',
            category
        };

        export const SHOW: Command = {
            id: 'output:pick-show',
            label: 'Show Output Channel...',
            category
        };

        export const HIDE: Command = {
            id: 'output:pick-hide',
            label: 'Hide Output Channel...',
            category
        };

        export const DISPOSE: Command = {
            id: 'output:pick-dispose',
            label: 'Close Output Channel...',
            category
        };

    }

    export interface Operation {

        readonly name: string;

        /**
         * Defaults to `() => true`.
         */
        readonly predicate?: (channel: OutputChannel, index: number, array: OutputChannel[]) => boolean;

    }

    export namespace Operation {

        export const DEFAULT: Operation = {
            name: ''
        };

        export const SHOW: Operation = {
            name: 'show'
        };

        export const HIDE: Operation = {
            name: 'hide',
            predicate: channel => channel.isVisible
        };

        export const CLEAR: Operation = {
            name: 'clear'
        };

        export const DISPOSE: Operation = {
            name: 'close'
        };

    }

}
