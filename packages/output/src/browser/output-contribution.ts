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

import { injectable } from 'inversify';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { CommonCommands, quickCommand } from '@theia/core/lib/browser';
import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { OutputWidget } from './output-widget';
import { OutputContextMenu } from './output-context-menu';

export namespace OutputCommands {

    const OUTPUT_CATEGORY = 'Output';

    /* #region VS Code `OutputChannel` API */
    // Based on: https://github.com/theia-ide/vscode/blob/standalone/0.19.x/src/vs/vscode.d.ts#L4692-L4745

    export const APPEND: Command = {
        id: 'output:append'
    };

    export const APPEND_LINE: Command = {
        id: 'output:appendLine'
    };

    export const CLEAR: Command = {
        id: 'output:clear'
    };

    export const SHOW: Command = {
        id: 'output:show'
    };

    export const HIDE: Command = {
        id: 'output:hide'
    };

    export const DISPOSE: Command = {
        id: 'output:dispose'
    };

    /* #endregion VS Code `OutputChannel` API */

    export const CLEAR__WIDGET: Command = {
        id: 'output:widget:clear',
        label: 'Clear Output',
        category: OUTPUT_CATEGORY,
        iconClass: 'clear-all'
    };

    export const LOCK__WIDGET: Command = {
        id: 'output:widget:lock',
        label: 'Turn Auto Scrolling Off',
        category: OUTPUT_CATEGORY,
        iconClass: 'fa fa-unlock'
    };

    export const UNLOCK__WIDGET: Command = {
        id: 'output:widget:unlock',
        label: 'Turn Auto Scrolling On',
        category: OUTPUT_CATEGORY,
        iconClass: 'fa fa-lock'
    };

}

@injectable()
export class OutputContribution extends AbstractViewContribution<OutputWidget> {

    constructor() {
        super({
            widgetId: OutputWidget.ID,
            widgetName: 'Output',
            defaultWidgetOptions: {
                area: 'bottom'
            },
            toggleCommandId: 'output:toggle',
            toggleKeybinding: 'CtrlCmd+Shift+U'
        });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(OutputCommands.CLEAR__WIDGET, {
            isEnabled: () => this.withWidget(),
            isVisible: () => this.withWidget(),
            execute: () => this.widget.then(widget => widget.clear())
        });
        registry.registerCommand(OutputCommands.LOCK__WIDGET, {
            isEnabled: widget => this.withWidget(widget, output => !output.isLocked),
            isVisible: widget => this.withWidget(widget, output => !output.isLocked),
            execute: () => this.widget.then(widget => widget.lock())
        });
        registry.registerCommand(OutputCommands.UNLOCK__WIDGET, {
            isEnabled: widget => this.withWidget(widget, output => output.isLocked),
            isVisible: widget => this.withWidget(widget, output => output.isLocked),
            execute: () => this.widget.then(widget => widget.unlock())
        });
        registry.registerCommand(OutputCommands.SHOW, {
            execute: ({ name, options }: { name: string, options?: { preserveFocus?: boolean } }) => {
                if (name) {
                    const preserveFocus = options && !!options.preserveFocus;
                    const activate = !preserveFocus;
                    const reveal = preserveFocus;
                    this.openView({ activate, reveal }).then(widget => widget.showChannel(name));
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
    }

    registerMenus(registry: MenuModelRegistry): void {
        super.registerMenus(registry);
        registry.registerMenuAction(OutputContextMenu.TEXT_EDIT_GROUP, {
            commandId: CommonCommands.COPY.id
        });
        registry.registerMenuAction(OutputContextMenu.COMMAND_GROUP, {
            commandId: quickCommand.id,
            label: 'Find Command...'
        });
        registry.registerMenuAction(OutputContextMenu.WIDGET_GROUP, {
            commandId: OutputCommands.CLEAR__WIDGET.id
        });
    }

    protected withWidget(
        widget: Widget | undefined = this.tryGetWidget(),
        predicate: (output: OutputWidget) => boolean = () => true
    ): boolean | false {

        return widget instanceof OutputWidget ? predicate(widget) : false;
    }

}
