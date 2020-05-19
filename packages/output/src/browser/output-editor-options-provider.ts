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
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoEditorOptionsProvider, MonacoOverrideServicesProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { MonacoContextMenuService } from '@theia/monaco/lib/browser/monaco-context-menu';
import { OutputUri } from '../common/output-uri';
import URI from '@theia/core/lib/common/uri';
import { OutputContextMenuService } from './output-context-menu';

@injectable()
export class OutputEditorProvider implements MonacoEditorOptionsProvider {

    canHandle(model: MonacoEditorModel): number {
        return OutputUri.is(model.uri) ? 1 : 0;
    }

    create(_: MonacoEditorModel, defaultOptions: MonacoEditor.IOptions): MonacoEditor.IOptions {
        return {
            ...defaultOptions,
            overviewRulerLanes: 3,
            lineNumbersMinChars: 3,
            fixedOverflowWidgets: true,
            wordWrap: 'off',
            lineNumbers: 'off',
            glyphMargin: false,
            lineDecorationsWidth: 20,
            rulers: [],
            folding: false,
            scrollBeyondLastLine: false,
            readOnly: true,
            renderLineHighlight: 'none',
            minimap: { enabled: false },
            matchBrackets: 'never'
        };
    }

}

@injectable()
export class OutputOverrideServicesProvider implements MonacoOverrideServicesProvider {

    @inject(OutputContextMenuService)
    protected readonly contextMenuService: MonacoContextMenuService;

    canHandle(uri: URI): number {
        return OutputUri.is(uri) ? 1 : 0;
    }

    create(uri: URI): { contextMenuService: MonacoContextMenuService } {
        return {
            contextMenuService: this.contextMenuService
        };
    }
}
