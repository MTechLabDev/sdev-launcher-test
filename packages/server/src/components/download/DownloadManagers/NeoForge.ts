import { spawn } from "child_process";
import { createHash } from "crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { extname, resolve } from "path";

import { HttpHelper, JsonHelper, ProfileLibrary, ZipHelper } from "@aurora-launcher/core";
import { Service } from "@freshgum/typedi";
import { LogHelper, StorageHelper } from "@root/helpers";
import { MojangManager } from "./Mojang";

import { InstallProfile, VersionProfiles, Libraries, NeoManifest } from "../interfaces/IForge";

@Service([])
export class NeoForgeManager extends MojangManager {
    #forgeInstall = "";
    #tempDir = StorageHelper.getTmpPath();

    override async downloadClient(gameVersion: string, clientName: string, loaderVersion?: string) {
        if (await this.downloadForge(gameVersion, loaderVersion)) {
            const profileUUID = await super.downloadClient(gameVersion, clientName);
            if (!profileUUID) return;

            LogHelper.info(
                this.langManager.getTranslate.DownloadManager.ForgeManager.client.install,
            );
            await this.startInstallerFile();

            const versionProfiles: VersionProfiles = JsonHelper.fromJson(
                readFileSync(resolve(this.#tempDir, "version.json")).toString(),
            );

            const lib = this.libParser(versionProfiles.libraries);
            this.libCopy(lib);

            this.profilesManager.editProfile(profileUUID, (profile) => ({
                mainClass: versionProfiles.mainClass,
                libraries: [...profile.libraries, ...lib],
                jvmArgs: versionProfiles.arguments.jvm,
                clientArgs: versionProfiles.arguments.game,
            }));

            rmSync(this.#tempDir, { recursive: true });
            LogHelper.info(
                this.langManager.getTranslate.DownloadManager.MirrorManager.client.success,
            );
        } else {
            LogHelper.error(
                this.langManager.getTranslate.DownloadManager.NeoforgeManager.info
                    .errForgeVersion,
            );
        }
    }

    async downloadForge(gameVersion: string, loaderVersion?: string) {
        try {
            mkdirSync(this.#tempDir);

            let version = loaderVersion;
            if (!version) {
                const manifest = await HttpHelper.getResourceFromJson<NeoManifest>(
                    `https://maven.neoforged.net/api/maven/latest/version/releases/net/neoforged/neoforge?filter=${gameVersion.slice(
                        2,
                    )}.`,
                );
                version = manifest.version;
            }

            const file = await HttpHelper.downloadFile(
                `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`,
                resolve(this.#tempDir, `neoforge-${version}-installer.jar`),
            );
            if (!file) return false;

            this.#forgeInstall = file;
            await ZipHelper.unzip(resolve(this.#tempDir, this.#forgeInstall), this.#tempDir);
            return true;
        } catch {
            return false;
        }
    }

    async startInstallerFile() {
        const launcherProfiles = JsonHelper.toJson({
            selectedProfile: "(Default)",
            profiles: { "(Default)": { name: "(Default)" } },
            clientToken: "",
        });
        writeFileSync(resolve(this.#tempDir, "launcher_profiles.json"), launcherProfiles);

        const installerProcess = spawn("java", [
            "-jar",
            resolve(this.#tempDir, this.#forgeInstall),
            "--installClient",
            this.#tempDir,
        ]);

        installerProcess.stdout.on("data", (data: Buffer) =>
            LogHelper.debug(data.toString().trimEnd()),
        );
        installerProcess.stderr.on("error", (data: Buffer) =>
            LogHelper.error(data.toString().trimEnd()),
        );

        await new Promise((resolve, reject) => {
            installerProcess.on("close", (code) => {
                if (code != 0) {
                    LogHelper.error(
                        this.langManager.getTranslate.DownloadManager.ForgeManager.info
                            .notFoundJava,
                    );
                    reject();
                }
                resolve(true);
            });
        });
    }

    libParser(libraries: Array<Libraries>): Array<ProfileLibrary> {
        const list: ProfileLibrary[] = [];

        for (const lib of libraries) {
            const name = lib.name.split(":")[1];
            if (name.search(/log4j|slf4j|failureaccess|jopt-simple/) === -1) {
                list.push({
                    path: lib.downloads.artifact.path,
                    sha1: lib.downloads.artifact.sha1,
                    type: "library",
                });
            }
        }

        const install_profile: InstallProfile = JsonHelper.fromJson(
            readFileSync(resolve(this.#tempDir, "install_profile.json")).toString(),
        );

        for (const lib of install_profile.libraries) {
            const name = lib.name.split(":")[1];
            if (name === "neoforge") {
                list.push({
                    path: lib.downloads.artifact.path,
                    sha1: lib.downloads.artifact.sha1,
                    type: "library",
                });

                const forgeClientPath = lib.downloads.artifact.path.replaceAll(
                    "universal",
                    "client",
                );
                const forgeClientSha1 = createHash("sha1")
                    .update(
                        readFileSync(resolve(this.#tempDir, "libraries", forgeClientPath)),
                    )
                    .digest("hex");
                list.push({ path: forgeClientPath, sha1: forgeClientSha1, type: "library" });
            }
        }

        const clientDir = readdirSync(
            resolve(this.#tempDir, "libraries/net/minecraft/client"),
        )[0];
        const files = readdirSync(
            resolve(this.#tempDir, "libraries/net/minecraft/client", clientDir),
        ).filter((s) => extname(s) === ".jar");

        for (const file of files) {
            list.push({
                path: `net/minecraft/client/${clientDir}/${file}`,
                sha1: createHash("sha1")
                    .update(
                        readFileSync(
                            resolve(
                                this.#tempDir,
                                "libraries/net/minecraft/client",
                                clientDir,
                                file,
                            ),
                        ),
                    )
                    .digest("hex"),
                type: "library",
                ignoreClassPath: true,
            });
        }

        return list;
    }

    libCopy(libraries: Array<ProfileLibrary>) {
        for (const lib of libraries) {
            cpSync(
                resolve(this.#tempDir, "libraries", lib.path),
                resolve(StorageHelper.librariesDir, lib.path),
            );
        }
    }
}
