import * as vscode from "vscode";
import nodeFetch, { RequestInit, RequestInfo, BodyInit, Response } from "node-fetch";
import { Agent as HttpsAgent, AgentOptions } from "https";
import { URLSearchParams } from "url";

import { computeAuth } from "./auth";
import { Builder, Build, ForceField } from "./api";

function* collect_fields(fields: ForceField[] | undefined): Generator<ForceField> {
    if (fields === undefined) {
        return;
    }
    for (const field of fields) {
        if (field.fullName) {
            yield field;
        }
        if (field.fields) {
            yield* collect_fields(field.fields);
        }
    }
}

export class Buildbot {
    private url: string | undefined;

    private user: string | undefined;

    private password: string | null | undefined;

    private headers: { [key: string]: string } = {};

    private httpsAgent: HttpsAgent | undefined;

    private makeAgent(options: AgentOptions = {}) {
        options.rejectUnauthorized = !vscode.workspace.getConfiguration("buildbot").get("allowSelf-signedCertificate", false);
        options.keepAlive = true;
        this.httpsAgent = new HttpsAgent(options);
    }

    private clearHeaders() {
        this.headers = { Connection: "Keep-Alive" };
    }

    private refreshConfig() {
        const config = vscode.workspace.getConfiguration("buildbot");
        const url: string | undefined = config.get("URL");
        const user: string | undefined = config.get("userName");
        if (url !== this.url || user !== this.user) {
            this.url = url;
            this.user = user;
            this.password = undefined;
            this.clearHeaders();
        }
        this.makeAgent();
    }

    private async readPassword() {
        const account = `buildbot-connect:${this.url}:${this.user}`;
        if (this.password === undefined) {
            this.password = await this.context.secrets.get(account);
            if (this.password !== undefined) {
                return;
            }
        }
        this.password = await vscode.window.showInputBox({
            prompt: `Enter password for user '${this.user}' on '${this.url}'`,
            ignoreFocusOut: true,
            password: true,
        });
        if (this.password) {
            await this.context.secrets.store(account, this.password);
        } else if (this.password === undefined) {
            this.password = null;
        }
    }

    private fetch(url: RequestInfo, init: RequestInit = {}) {
        if (this.httpsAgent) {
            init.agent = this.httpsAgent;
        }
        init.timeout = 3000;
        return nodeFetch(url, init);
    }

    private async request(endpoint: string, data?: {}) {
        const url = `${this.url}/api/v2/${endpoint}`;

        let askPass = !this.password;

        const method = data ? "POST" : "GET";
        const body = data ? JSON.stringify(data) : undefined;

        try {
            while (true) {
                let headers = this.headers;
                if (data) {
                    if (!headers) {
                        headers = {};
                    }
                    headers["Content-Type"] = "application/json";
                }

                let resp = await this.fetch(url, {
                    headers: headers,
                    method: method,
                    body: body,
                });
                if (resp.ok) {
                    return await resp.json();
                }

                if (resp.status !== 401 && resp.status !== 403) {
                    await this.throwRequestError(resp);
                }

                while (!this.user) {
                    this.user = await vscode.window.showInputBox({
                        prompt: `Enter Buildbot web UI user name on '${this.url}'`,
                        ignoreFocusOut: true
                    });
                    if (this.user === undefined) { return; }
                    vscode.workspace.getConfiguration("buildbot").update("userName", this.user);
                    askPass = true;
                }

                if (askPass) {
                    await this.readPassword();
                }
                if (this.password === null || this.password === undefined) {
                    break;
                }
                askPass = true;

                this.clearHeaders();

                if (resp.status === 401) {
                    this.headers["Authorization"] = computeAuth(resp, this.user, this.password, method ? method : "GET");
                    resp = await this.fetch(`${this.url}/`, {
                        headers: this.headers,
                    });
                } else {
                    const auth = computeAuth(await this.fetch(`${this.url}/auth/login`), this.user, this.password);
                    resp = await this.fetch(`${this.url}/auth/login`, {
                        headers: { Authorization: auth },
                        redirect: "manual",
                    });
                }
                if (resp.ok || nodeFetch.isRedirect(resp.status)) {
                    const cookies = resp.headers.raw()["set-cookie"];
                    const cookie = cookies?.reverse().find((c) => c.startsWith("TWISTED_SESSION="));
                    if (cookie) {
                        this.headers["Cookie"] = cookie.split("; ")[0];
                    }
                }
            }
        } catch (err) {
            vscode.window.showErrorMessage(`There was an error processing your request: ${(<any> err).message}`);
        }
    }

    private async throwRequestError(resp: Response) {
        var error;
        try {
            error = (<any> await resp.json()).error;
        } catch {
            throw Error(resp.statusText);
        }
        if (!error) {
            throw Error(resp.statusText);
        }
        if (error.message instanceof String) {
            throw error;
        }
        else {
            throw Object.entries(error.message)
                .map((e) => `${e[0]}: ${e[1]}`)
                .join("; ");
        }
    }

    private async getBuilders(): Promise<Builder[]> {
        return (<any> await this.request("builders")).builders.filter((b: Builder) => b.masterids.length);
    }

    private async getBuilds(endpoint: string): Promise<Build[]> {
        const builds = (<any> await this.request(endpoint)).builds;
        for (const build of builds) {
            build.started_at = new Date(build.started_at * 1000);
            if (build.complete_at) {
                build.complete_at = new Date(build.complete_at * 1000);
            }
        }
        return builds;
    }

    private getBuilderBuilds(builder: Builder, options: { [key: string]: any }): Promise<Build[]> {
        let params = new URLSearchParams(options);
        return this.getBuilds(`builders/${builder.builderid}/builds?${params.toString()}`);
    }

    private async pickBuilder(): Promise<Builder | undefined> {
        const builders = await this.getBuilders();
        const picked = await vscode.window.showQuickPick(
            builders.map((b) => ({
                label: b.name,
                description: b.tags?.join(", "),
                detail: b.description,
            })),
            {
                ignoreFocusOut: true,
            }
        );
        if (picked) {
            return builders.find((b) => b.name === picked.label);
        }
    }

    dispose() {}

    private async notConfigured() {
        if (!this.url) {
            if (
                await vscode.window.showWarningMessage(
                    "Buildbot Connect is not configured. Please define Buildbot URL...",
                    "Set Buildbot URL"
                )
            ) {
                const url = await vscode.window.showInputBox({
                    prompt: "Enter URL of your Buildbot web UI",
                    ignoreFocusOut: true,
                });
                if (url !== undefined) {
                    this.url = url;
                    vscode.workspace.getConfiguration("buildbot").update("URL", url);
                    return false;
                }
            }
            return true;
        } else {
            return false;
        }
    }

    constructor(private readonly context: vscode.ExtensionContext) {
        this.refreshConfig();
        vscode.workspace.onDidChangeConfiguration(() => {
            this.refreshConfig();
        });
        vscode.commands.registerCommand("buildbot-connect.openBuildbot", () => {
            this.openBuildbot();
        });
        vscode.commands.registerCommand("buildbot-connect.listBuilders", () => {
            this.listBuilders();
        });
        vscode.commands.registerCommand("buildbot-connect.showLastBuilds", () => {
            this.showLastBuilds();
        });
        vscode.commands.registerCommand("buildbot-connect.forceBuild", () => {
            this.forceBuild();
        });
        vscode.commands.registerCommand("buildbot-connect.stopBuild", () => {
            this.stopBuild();
        });
    }

    async openBuildbot() {
        if (await this.notConfigured()) {
            return;
        }
        const pick = await vscode.window.showQuickPick(
            [
                { label: "Home", page: "" },
                { label: "Waterfall View", page: "waterfal" },
                { label: "Console View", page: "console" },
            ],
            {
                placeHolder: "Which Buildbot page do you want to open?",
            }
        );
        if (pick) {
            vscode.env.openExternal(vscode.Uri.parse(`${this.url}/#/${pick.page}`));
        }
    }

    async listBuilders() {
        if (await this.notConfigured()) {
            return;
        }
        const builder = await this.pickBuilder();
        if (builder) {
            vscode.env.openExternal(vscode.Uri.parse(`${this.url}/#/builders/${builder.builderid}`));
        }
    }

    private async getLastBuildsWithProgress(progress: vscode.Progress<{ increment: number; message: string }>) {
        progress.report({ increment: 0, message: "getting builder list..." });
        const builders = await this.getBuilders();
        const steps = builders.length;
        let i = 1;
        for (const b of builders) {
            progress.report({
                increment: (i * 100) / steps,
                message: `getting last build for builder '${b.name}'...`,
            });
            const builds = await this.getBuilderBuilds(b, {
                order: "-number",
                complete: true,
                limit: 1,
            });
            if (builds) {
                b.last_build = builds[0];
            }
        }
        return builders;
    }

    async showLastBuilds() {
        if (await this.notConfigured()) {
            return;
        }
        const builders = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Show Builds",
                cancellable: false,
            },
            (progress, token) => this.getLastBuildsWithProgress(progress)
        );
        const pick = await vscode.window.showQuickPick(
            builders.map((b) => ({
                label: b.name,
                detail: b.last_build
                    ? `Last build on ${b.last_build.complete_at?.toLocaleString()} (${b.last_build.state_string})`
                    : undefined,
                last_build: b.last_build,
            })),
            {
                ignoreFocusOut: true,
            }
        );
        if (pick && pick.last_build) {
            vscode.env.openExternal(
                vscode.Uri.parse(`${this.url}/#/builders/${pick.last_build.builderid}/builds/${pick.last_build.buildid}`)
            );
        }
    }

    async forceBuild() {
        if (await this.notConfigured()) {
            return;
        }
        const schedulers = (<any> await this.request("forceschedulers")).forceschedulers;
        if (schedulers.length === 0) {
            vscode.window.showInformationMessage("No ForceScheduler schedulers are defined in your Buildbot");
            return;
        }
        let scheduler = schedulers[0];
        if (schedulers.length > 1) {
            scheduler = await vscode.window.showQuickPick(schedulers, {
                placeHolder: "Select force scheduler to activate",
                ignoreFocusOut: true,
            });
            if (scheduler === undefined) {
                return;
            }
        }

        const bn = await vscode.window.showQuickPick(scheduler.builder_names, {
            placeHolder: "Select builder to start",
            ignoreFocusOut: true,
        });
        const builder = (await this.getBuilders()).find((b) => b.name === bn)!;

        const fields = [...collect_fields(scheduler.all_fields)].filter((f) => f.fullName !== "username" && f.fullName !== "owner");

        let params: { [key: string]: any } = {};
        for (const field of fields) {
            if (field.type === "fixed" && field.default) {
                params[field.fullName!] = field.default;
            }
        }

        const picks: {
            original_label?: string;
            label: string;
            description?: string;
            required?: boolean;
            param?: string;
        }[] = fields
            .filter((f) => f.type !== "fixed" && !f.hide)
            .map((f) => ({
                original_label: f.label,
                label: `${f.label}${f.required && !f.default ? "$(warning)" : ""}`,
                description: f.default,
                required: f.required,
                param: f.fullName!,
            }));
        if (picks) {
            const start = {
                alwaysShow: true,
                label: "$(run-all) Start Build",
                detail: "Click here to force the build or select a parameter to change",
            };
            picks.splice(0, 0, start);

            while (true) {
                const pick = await vscode.window.showQuickPick(picks, {
                    placeHolder: `Forcing build on '${builder.name}'`,
                    ignoreFocusOut: true,
                });
                if (!pick) {
                    return;
                }
                if (pick === start) {
                    break;
                }
                const description = await vscode.window.showInputBox({
                    prompt: `Enter ${pick.original_label}`,
                    value: pick.description,
                    ignoreFocusOut: true,
                });
                if (description !== undefined) {
                    pick.description = description;
                }
                pick.label = `${pick.original_label}${pick.required && !pick.description ? "$(warning)" : ""}`;
            }

            for (const pick of picks) {
                if (pick.param) {
                    params[pick.param] = pick.description;
                }
            }
        }

        params.builderid = builder.builderid;
        params.owner = this.user;

        if (
            await this.request(`forceschedulers/${scheduler.name}`, {
                jsonrpc: "2.0",
                id: "1",
                method: "force",
                params: params,
            })
        ) {
            vscode.window.showInformationMessage(`Forced build of '${builder.name}'`);
        }
    }

    async stopBuild() {
        if (await this.notConfigured()) {
            return;
        }
        const builders = await this.getBuilders();
        const builds = await this.getBuilds("builds?complete=false");

        if (!builds || !builds.length) {
            vscode.window.showInformationMessage("There are no running builds");
            return;
        }

        for (const build of builds) {
            build.builder_name = builders.find((b) => b.builderid === build.builderid)!.name;
        }

        const picked = await vscode.window.showQuickPick(
            builds.map((b) => ({
                label: `Build ${b.number} on '${b.builder_name}'`,
                detail: `started at ${b.started_at.toLocaleTimeString()}`,
                buildid: b.buildid,
            })),
            { placeHolder: "Select a build to stop...", ignoreFocusOut: true }
        );
        if (!picked) {
            return;
        }

        // const reason = await vscode.window.showInputBox({
        //     prompt: "Give the reason why the build is stopped",
        // ignoreFocusOut: true,
        // });
        // if (reason === undefined) {
        //     return;
        // }

        if (
            await this.request(`builds/${picked.buildid}`, {
                jsonrpc: "2.0",
                id: "1",
                method: "stop",
                params: { reason: "Stopped in Visual Studio Code" },
            })
        ) {
            vscode.window.showInformationMessage(`${picked.label} stopped`);
        }
    }
}
