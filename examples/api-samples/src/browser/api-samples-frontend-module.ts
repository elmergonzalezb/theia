/********************************************************************************
 * Copyright (C) 2019 Arm and others.
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

import { ContainerModule, inject, injectable } from 'inversify';
import { bindDynamicLabelProvider } from './label/sample-dynamic-label-provider-command-contribution';
import { bindSampleUnclosableView } from './view/sample-unclosable-view-contribution';
import { bindSampleOutputChannelWithSeverity } from './output/sample-output-channel-with-severity';
import { CommandRegistry, CommandContribution, Disposable, DisposableCollection } from '@theia/core';
import { OutputChannelManager, OutputChannel, OutputChannelSeverity } from '@theia/output/lib/common/output-channel';

export default new ContainerModule(bind => {
    bindDynamicLabelProvider(bind);
    bindSampleUnclosableView(bind);
    bindSampleOutputChannelWithSeverity(bind);
    bind(CommandContribution).to(SampleOutputChannelsCommandContribution).inSingletonScope();
});

@injectable()
class SampleOutputChannelsCommandContribution implements CommandContribution {

    @inject(OutputChannelManager)
    private readonly ocm: OutputChannelManager;

    private toDispose = new Map<string, Disposable>();

    registerCommands(commands: CommandRegistry): void {
        this.ocm.onChannelDeleted(({ name }) => {
            const toDisposePerChannel = this.toDispose.get(name);
            if (toDisposePerChannel) {
                toDisposePerChannel.dispose();
            }
        });
        for (const channelName of ['one', 'two', 'three']) {
            const command = { id: `post-date-now-${channelName}`, label: `API Sample: Post Date.now() to the '${channelName}' channel.` };
            commands.registerCommand(command, {
                execute: () => {
                    const toDisposePerChannel = this.toDispose.get(channelName);
                    if (toDisposePerChannel) {
                        toDisposePerChannel.dispose();
                    } else {
                        const channel = this.getChannel(channelName);
                        channel.setVisibility(true);
                        const timer = window.setInterval(() => this.appendLineTo(channelName, Date.now()), 200);
                        this.toDispose.set(channelName, new DisposableCollection(
                            Disposable.create(() => this.toDispose.delete(channelName)),
                            Disposable.create(() => window.clearInterval(timer))
                        ));
                    }
                }
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private appendLineTo(channelName: string, what: any): void {
        const severity = Math.floor(Math.random() * 3) + 1;
        if (severity === OutputChannelSeverity.Warning) {
            what = what + ' [WARNING]';
        } else if (severity === OutputChannelSeverity.Error) {
            what = what + ' [ERROR]';
        }
        this.getChannel(channelName).appendLine(`[${channelName}]: ${what}`, severity);
    }

    private getChannel(channelName: string): OutputChannel {
        const channel = this.ocm.getChannel(channelName);
        if (channel) {
            return channel;
        } else {
            throw new Error(`Ouch. No channel was found with name: '${channelName}'.`);
        }
    }

}
