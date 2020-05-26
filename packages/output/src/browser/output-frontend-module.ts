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

import { ContainerModule } from 'inversify';
import { OutputWidget, OUTPUT_WIDGET_KIND } from './output-widget';
import { CommandContribution } from '@theia/core/lib/common/command';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ResourceResolver } from '@theia/core/lib/common';
import { WidgetFactory, bindViewContribution } from '@theia/core/lib/browser';
import { OutputChannelManager } from '../common/output-channel';
import { bindOutputPreferences } from '../common/output-preferences';
import { OutputToolbarContribution } from './output-toolbar-contribution';
import { OutputContribution } from './output-contribution';
import { MonacoEditorModelFactoryHandler } from '@theia/monaco/lib/browser/monaco-editor-model';
import { OutputEditorModelFactoryHandler } from './output-editor-model';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(OutputChannelManager).toSelf().inSingletonScope();
    bind(CommandContribution).toService(OutputChannelManager);
    bind(ResourceResolver).toService(OutputChannelManager);
    bind(MonacoEditorModelFactoryHandler).to(OutputEditorModelFactoryHandler).inSingletonScope();

    bindOutputPreferences(bind);

    bind(OutputWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: OUTPUT_WIDGET_KIND,
        createWidget: () => context.container.get<OutputWidget>(OutputWidget)
    }));
    bindViewContribution(bind, OutputContribution);

    bind(OutputToolbarContribution).toSelf().inSingletonScope();
    bind(TabBarToolbarContribution).toService(OutputToolbarContribution);
});
