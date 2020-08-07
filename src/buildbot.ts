import * as vscode from "vscode";
import nodeFetch, { RequestInit, RequestInfo } from "node-fetch";
import { Agent as HttpsAgent } from "https";
import * as keytar from "keytar";

import { Builder } from "./api";
import { computeAuth } from "./auth";

const KEYTAR_SERVICE = "VSCode Buildbot Connect";

export class Buildbot {
  private url: string | undefined;

  private user: string | undefined;

  private password: string | null | undefined;

  private headers: { [key: string]: string } | undefined;

  private httpsAgent: HttpsAgent | undefined;

  private refreshConfig() {
    const config = vscode.workspace.getConfiguration("buildbot");
    const url: string | undefined = config.get("URL");
    const user: string | undefined = config.get("userName");
    if (url !== this.url || user !== this.user) {
      this.url = url;
      this.user = user;
      this.password = undefined;
      this.headers = undefined;
    }
    if (config.get("allowSelf-signedCertificate", false)) {
      this.httpsAgent = new HttpsAgent({ rejectUnauthorized: false });
    } else {
      this.httpsAgent = undefined;
    }
  }

  private async readPassword() {
    const account = `${this.url}:${this.user}`;
    if (this.password === undefined) {
      this.password = await keytar.getPassword(KEYTAR_SERVICE, account);
      if (this.password !== null) {
        return;
      }
    }
    this.password = await vscode.window.showInputBox({
      prompt: `Enter password for user '${this.user}' on '${this.url}'`,
      password: true,
    });
    if (this.password) {
      await keytar.setPassword(KEYTAR_SERVICE, account, this.password);
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

  private async request(endpoint: string, method?: string, body?: string) {
    const url = `${this.url}/api/v2/${endpoint}`;

    try {
      while (true) {
        let resp = await this.fetch(url, {
          headers: this.headers,
          method: method,
          body: body,
        });
        if (resp.ok) {
          return resp.json();
        }

        if (!this.user || (resp.status !== 401 && resp.status !== 403)) {
          throw Error(resp.statusText);
        }

        await this.readPassword();
        if (this.password === null || this.password === undefined) {
          break;
        }

        this.headers = {};

        if (resp.status === 401) {
          this.headers["Authorization"] = computeAuth(
            resp,
            this.user,
            this.password,
            method ? method : "GET"
          );
        } else {
          const auth = computeAuth(
            await this.fetch(`${this.url}/auth/login`),
            this.user,
            this.password
          );
          let lresp = await this.fetch(`${this.url}/auth/login`, {
            headers: { Authorization: auth },
            redirect: "manual",
          });
          if (lresp.ok || nodeFetch.isRedirect(lresp.status)) {
            const cookies = lresp.headers.raw()["set-cookie"];
            const cookie = cookies
              ?.reverse()
              .find((c) => c.startsWith("TWISTED_SESSION="));
            if (cookie) {
              this.headers["Cookie"] = cookie.split("; ")[0];
            }
          }
        }
      }
    } catch (err) {
      vscode.window.showInformationMessage(
        `There was an error processing your request: ${err.message}`
      );
    }
  }

  private async getBuilders(): Promise<Builder[]> {
    const data = await this.request("builders");
    return data.builders.filter((b: Builder) => b.masterids.length);
  }

  private async pickBuilder(): Promise<Builder | undefined> {
    const builders = await this.getBuilders();
    const picked = await vscode.window.showQuickPick(
      builders.map((b) => b.name)
    );
    if (picked) {
      return builders.find((b) => b.name === picked);
    }
  }

  dispose() {}

  constructor(private readonly context: vscode.ExtensionContext) {
    this.refreshConfig();
    vscode.workspace.onDidChangeConfiguration(() => {
      this.refreshConfig();
    });
    vscode.commands.registerCommand("buildbot-connect.openAllBuilders", () => {
      this.openAllBuilders();
    });
    vscode.commands.registerCommand("buildbot-connect.openBuilder", () => {
      this.openBuilder();
    });
    vscode.commands.registerCommand("buildbot-connect.forceBuild", () => {
      this.forceBuild();
    });
  }

  openAllBuilders() {
    vscode.env.openExternal(vscode.Uri.parse(`${this.url}/#/builders`));
  }

  async openBuilder() {
    const builder = await this.pickBuilder();
    if (builder) {
      vscode.env.openExternal(
        vscode.Uri.parse(`${this.url}/#/builders/${builder.builderid}`)
      );
    }
  }

  async forceBuild() {}
}
