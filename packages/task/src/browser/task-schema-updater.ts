/********************************************************************************
 * Copyright (C) 2019 Red Hat, Inc. and others.
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
import { JsonSchemaStore } from '@theia/core/lib/browser/json-schema-store';
import { InMemoryResources, deepClone } from '@theia/core/lib/common';
import { IJSONSchema } from '@theia/core/lib/common/json-schema';
import { inputsSchema } from '@theia/variable-resolver/lib/browser/variable-input-schema';
import URI from '@theia/core/lib/common/uri';
import { ProblemMatcherRegistry } from './task-problem-matcher-registry';
import { TaskDefinitionRegistry } from './task-definition-registry';
import { TaskServer } from '../common';

export const taskSchemaId = 'vscode://schemas/tasks';

@injectable()
export class TaskSchemaUpdater {
    @inject(JsonSchemaStore)
    protected readonly jsonSchemaStore: JsonSchemaStore;

    @inject(InMemoryResources)
    protected readonly inmemoryResources: InMemoryResources;

    @inject(ProblemMatcherRegistry)
    protected readonly problemMatcherRegistry: ProblemMatcherRegistry;

    @inject(TaskDefinitionRegistry)
    protected readonly taskDefinitionRegistry: TaskDefinitionRegistry;

    @inject(TaskServer)
    protected readonly taskServer: TaskServer;

    @postConstruct()
    protected init(): void {
        this.updateProblemMatcherNames();
        this.updateSupportedTaskTypes();
        // update problem matcher names in the task schema every time a problem matcher is added or disposed
        this.problemMatcherRegistry.onDidChangeProblemMatcher(() => this.updateProblemMatcherNames());
        // update supported task types in the task schema every time a task definition is registered or removed
        this.taskDefinitionRegistry.onDidRegisterTaskDefinition(() => this.updateSupportedTaskTypes());
        this.taskDefinitionRegistry.onDidUnregisterTaskDefinition(() => this.updateSupportedTaskTypes());
    }

    update(): void {
        const taskSchemaUri = new URI(taskSchemaId);
        const schemaContent = this.getStrigifiedTaskSchema();
        try {
            this.inmemoryResources.update(taskSchemaUri, schemaContent);
        } catch (e) {
            this.inmemoryResources.add(taskSchemaUri, schemaContent);
            this.jsonSchemaStore.registerSchema({
                fileMatch: ['tasks.json'],
                url: taskSchemaUri.toString()
            });
        }
    }

    /** Returns an array of task types that are registered, including the default types */
    async getRegisteredTaskTypes(): Promise<string[]> {
        const serverSupportedTypes = await this.taskServer.getRegisteredTaskTypes();
        const browserSupportedTypes = this.taskDefinitionRegistry.getAll().map(def => def.taskType);
        const allTypes = new Set([...serverSupportedTypes, ...browserSupportedTypes]);
        return Array.from(allTypes.values()).sort();
    }

    /** Returns the task's JSON schema */
    getTaskSchema(): IJSONSchema {
        return {
            properties: {
                tasks: {
                    type: 'array',
                    items: {
                        ...deepClone(taskConfigurationSchema)
                    }
                },
                inputs: inputsSchema.definitions!.inputs
            }
        };
    }

    /** Returns the task's JSON schema as a string */
    private getStrigifiedTaskSchema(): string {
        return JSON.stringify(this.getTaskSchema());
    }

    /** Gets the most up-to-date names of problem matchers from the registry and update the task schema */
    private updateProblemMatcherNames(): void {
        const matcherNames = this.problemMatcherRegistry.getAll().map(m => m.name.startsWith('$') ? m.name : `$${m.name}`);
        problemMatcherNames.length = 0;
        problemMatcherNames.push(...matcherNames);
        this.update();
    }

    /** Gets the most up-to-date names of task types Theia supports from the registry and update the task schema */
    private async updateSupportedTaskTypes(): Promise<void> {
        const allTypes = await this.getRegisteredTaskTypes();
        supportedTaskTypes.length = 0;
        supportedTaskTypes.push(...allTypes);
        this.update();
    }
}

const commandSchema: IJSONSchema = {
    type: 'string',
    description: 'The actual command or script to execute'
};

const commandArgSchema: IJSONSchema = {
    type: 'array',
    description: 'A list of strings, each one being one argument to pass to the command',
    items: {
        type: 'string'
    }
};

const commandOptionsSchema: IJSONSchema = {
    type: 'object',
    description: 'The command options used when the command is executed',
    properties: {
        cwd: {
            type: 'string',
            description: 'The directory in which the command will be executed',
            default: '${workspaceFolder}'
        },
        env: {
            type: 'object',
            description: 'The environment of the executed program or shell. If omitted the parent process\' environment is used'
        },
        shell: {
            type: 'object',
            description: 'Configuration of the shell when task type is `shell`',
            properties: {
                executable: {
                    type: 'string',
                    description: 'The shell to use'
                },
                args: {
                    type: 'array',
                    description: `The arguments to be passed to the shell executable to run in command mode
                        (e.g ['-c'] for bash or ['/S', '/C'] for cmd.exe)`,
                    items: {
                        type: 'string'
                    }
                }
            }
        }
    }
};

const problemMatcherNames: string[] = [];
const supportedTaskTypes = ['shell', 'process']; // default types that Theia supports
const taskConfigurationSchema: IJSONSchema = {
    $id: taskSchemaId,
    oneOf: [
        {
            allOf: [
                {
                    type: 'object',
                    required: ['type'],
                    properties: {
                        label: {
                            type: 'string',
                            description: 'A unique string that identifies the task that is also used as task\'s user interface label'
                        },
                        type: {
                            type: 'string',
                            enum: supportedTaskTypes,
                            default: 'shell',
                            description: 'Determines what type of process will be used to execute the task. Only shell types will have output shown on the user interface'
                        },
                        command: commandSchema,
                        args: commandArgSchema,
                        options: commandOptionsSchema,
                        windows: {
                            type: 'object',
                            description: 'Windows specific command configuration that overrides the command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        osx: {
                            type: 'object',
                            description: 'MacOS specific command configuration that overrides the command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        linux: {
                            type: 'object',
                            description: 'Linux specific command configuration that overrides the default command, args, and options',
                            properties: {
                                command: commandSchema,
                                args: commandArgSchema,
                                options: commandOptionsSchema
                            }
                        },
                        problemMatcher: {
                            oneOf: [
                                {
                                    type: 'string',
                                    description: 'Name of the problem matcher to parse the output of the task',
                                    enum: problemMatcherNames
                                },
                                {
                                    type: 'object',
                                    description: 'User defined problem matcher(s) to parse the output of the task',
                                },
                                {
                                    type: 'array',
                                    description: 'Name(s) of the problem matcher(s) to parse the output of the task',
                                    items: {
                                        type: 'string',
                                        enum: problemMatcherNames
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        }
    ]
};
