/********************************************************************************
 * Copyright (C) 2020 Ericsson and others.
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
import { Deferred } from '@theia/core/lib/common/promise-util';

/**
 * This class provide some kind of state synchronization mechanism.
 *
 * The Electron application can wait for states to be set in order to lock certain processes.
 */
@injectable()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ElectronApplicationState<T = any> {

    protected readonly states = new Map<T, Deferred<void>>();

    setStateReached(state: T): void {
        this.getStateDeferred(state).resolve();
    }

    async waitForAll(...states: T[]): Promise<void> {
        if (states.length === 1) {
            return this.getStatePromise(states[0]);
        }
        await Promise.all(states.map(state => this.getStatePromise(state)));
    }

    async waitForAny(...states: T[]): Promise<void> {
        if (states.length === 1) {
            return this.getStatePromise(states[0]);
        }
        await Promise.race(states.map(state => this.getStatePromise(state)));
    }

    protected getStateDeferred(state: T): Deferred<void> {
        let deferred = this.states.get(state);
        if (typeof deferred === 'undefined') {
            this.states.set(state, deferred = new Deferred<void>());
        }
        return deferred;
    }

    protected getStatePromise(state: T): Promise<void> {
        return this.getStateDeferred(state).promise;
    }

}
