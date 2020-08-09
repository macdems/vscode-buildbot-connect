# Buildbot Connect README

Buildbot is a system to automate the compile/test cycle required by most software projects to validate code changes. By automatically rebuilding and testing the project each time something has changed, build problems are pinpointed quickly, before other developers are inconvenienced by the failure.

This extension provides connection between Visual Studio Code and Buildbot. It allows to manually start and stop builds and check their status without leaving the IDE.

## Features

- List active builders and quickly open them in a browser.
- Show last build time and status.
- Quickly open specific Buildbot web interface page.
- Force a build using configured [force scheduler](https://docs.buildbot.net/current/manual/configuration/schedulers.html#forcescheduler-scheduler).
- Stop any running build.

<!-- Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow. -->

## Extension Settings

This extension uses Buildbot REST API, so you need a properly configured Buildbot web interface. In order to use it, you need to specify the following settings (it is recommended to set them in the workspace of folder scope):

- `buildbot.URL`: URL address of your Buildbot web interface.
- `buildbot.allowSelf-signedCertificate`: you need to set it to `true` if your Buildbot is accessed through HTTPS with a self-signed certificate. Otherwise I recommend to leave to `false`.
- `buildbot.userName`: if your buildbot web API requires login, specify the username here. You will be asked for a password during the first connection attempt and it will be stored securely. Only HTTP authorization and simple username/password authentication is supported.

## Known Issues

If you have no right to access some sub-page, the plugin will keep asking you for a password.

## Release Notes

Users appreciate release notes as you update your extension.

### 0.2.0

Add keep-alive to HTTP connection. Some operations are faster.

### 0.1.1

Bugfixes.

### 0.1.0

Initial release of Buildbot Connect.
