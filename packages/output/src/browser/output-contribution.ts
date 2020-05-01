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

import { injectable, inject } from 'inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KeybindingRegistry, KeybindingContext, ApplicationShell, Widget } from '@theia/core/lib/browser';
import { OutputWidget } from './output-widget';

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

    // XXX: verify if we need this for the monaco editor.
    export const SELECT_ALL__WIDGET: Command = {
        id: 'output:widget:selectAll',
        label: 'Select All',
        category: OUTPUT_CATEGORY
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

/**
 * Enabled when the `Output` widget is the `activeWidget` in the shell.
 */
@injectable()
export class OutputWidgetIsActiveContext implements KeybindingContext {

    static readonly ID = 'output:isActive';

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    readonly id = OutputWidgetIsActiveContext.ID;

    isEnabled(): boolean {
        return this.shell.activeWidget instanceof OutputWidget;
    }

}

// TODO: rename to `OutputViewContribution` to better reflect to what it does.
@injectable()
export class OutputContribution extends AbstractViewContribution<OutputWidget> {

    @inject(OutputWidgetIsActiveContext)
    protected readonly outputIsActiveContext: OutputWidgetIsActiveContext;

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

    registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(OutputCommands.CLEAR__WIDGET, {
            isEnabled: () => this.withWidget(),
            isVisible: () => this.withWidget(),
            execute: () => this.widget.then(widget => widget.clear())
        });
        commands.registerCommand(OutputCommands.SELECT_ALL__WIDGET, {
            isEnabled: widget => this.withWidget(widget),
            isVisible: widget => this.withWidget(widget),
            execute: () => this.widget.then(widget => widget.selectAll())
        });
        commands.registerCommand(OutputCommands.LOCK__WIDGET, {
            isEnabled: widget => this.withWidget(widget, output => !output.isLocked),
            isVisible: widget => this.withWidget(widget, output => !output.isLocked),
            execute: () => this.widget.then(widget => widget.lock())
        });
        commands.registerCommand(OutputCommands.UNLOCK__WIDGET, {
            isEnabled: widget => this.withWidget(widget, output => output.isLocked),
            isVisible: widget => this.withWidget(widget, output => output.isLocked),
            execute: () => this.widget.then(widget => widget.unlock())
        });
    }

    // See comment on `SELECT_ALL__SELECTED`, I think we won't need this.
    registerKeybindings(registry: KeybindingRegistry): void {
        super.registerKeybindings(registry);
        registry.registerKeybindings({
            command: OutputCommands.SELECT_ALL__WIDGET.id,
            keybinding: 'CtrlCmd+A',
            context: OutputWidgetIsActiveContext.ID
        });
    }

    protected withWidget(
        widget: Widget | undefined = this.tryGetWidget(),
        predicate: (output: OutputWidget) => boolean = () => true
    ): boolean | false {

        return widget instanceof OutputWidget ? predicate(widget) : false;
    }

}
