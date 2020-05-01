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

import { injectable } from 'inversify';
import { MonacoToProtocolConverter, ProtocolToMonacoConverter } from 'monaco-languageclient';
import { Resource } from '@theia/core/lib/common/resource';
import { MaybePromise } from '@theia/core/lib/common/types';
import { MonacoEditorModelFactoryHandler, MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { OutputUri } from '../common/output-uri';

@injectable()
export class OutputEditorModelFactoryHandler implements MonacoEditorModelFactoryHandler {

    canHandle(resource: Resource): MaybePromise<number> {
        // TODO: check TS error here
        // @ts-ignore
        return OutputUri.is(resource.uri) ? 1 : 0;
    }

    async createModel(
        resource: Resource,
        m2p: MonacoToProtocolConverter,
        p2m: ProtocolToMonacoConverter):
        Promise<MonacoEditorModel> {

        return new OutputEditorModel(resource, m2p, p2m);
    }

}

export class OutputEditorModel extends MonacoEditorModel {

    get readOnly(): boolean {
        return true;
    }

    protected setDirty(dirty: boolean): void {
        // NOOP
    }

}
