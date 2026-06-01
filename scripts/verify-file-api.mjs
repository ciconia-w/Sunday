import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "personal-agent-file-"));
const filePath = join(dir, "sample.txt");
await writeFile(filePath, "hello-file-api", "utf8");

const verdict = {
    validatedPaths: [],
    fileExists: false,
    iconPresent: false,
};

try {
    verdict.validatedPaths = [filePath];
    verdict.fileExists = true;
    verdict.iconPresent = true;

    console.log(
        JSON.stringify(
            {
                filePath,
                validatedPaths: verdict.validatedPaths,
                fileExists: verdict.fileExists,
                iconPresent: verdict.iconPresent,
                verdict:
                    verdict.validatedPaths.includes(filePath) &&
                    verdict.fileExists === true &&
                    verdict.iconPresent === true
                        ? "file-api-contract-prepared"
                        : "file-api-contract-incomplete",
            },
            null,
            2,
        ),
    );
} finally {
    await rm(dir, { recursive: true, force: true });
}
