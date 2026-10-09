// use_preview: the marketplace preview of a widget is a PNG under assets/,
// usually rendered by a test scenario at 150 %. An assistant's file tools
// write text, not images: this copies one reference image into
// assets/preview.png, inside the widget, and never overwrites a file.

import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DESCRIPTIONS } from "../texts.js";
import { fail, ok, type ToolEnv, widgetDirectory, withRoots } from "./common.js";

const NAME = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const MAX_PREVIEW_BYTES = 256 * 1024;

async function pngSize(path: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (
      bytesRead < 24 ||
      header.readUInt32BE(0) !== 0x89504e47 ||
      header.toString("latin1", 12, 16) !== "IHDR"
    ) {
      return null;
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

export function registerPreviewTool(env: ToolEnv): void {
  env.server.registerTool(
    "use_preview",
    {
      title: "Use an image as the preview",
      description: DESCRIPTIONS.use_preview,
      inputSchema: z.strictObject({
        directory: z
          .string()
          .min(1)
          .max(1024)
          .describe("The widget folder, relative to the project folder."),
        scenario: NAME.describe(
          "The scenario whose reference image to use (tests/reference/<scenario>/).",
        ),
        image: NAME.describe("The image name, without .png."),
      }),
      outputSchema: z.object({
        directory: z.string(),
        preview: z.string(),
        bytes: z.number(),
        width: z.number(),
        height: z.number(),
        fourByThree: z.boolean(),
        next: z.string(),
      }),
      annotations: {
        title: "Use an image as the preview",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ directory, scenario, image }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const target = await widgetDirectory(confinement, directory);
        const source = await confinement.resolve(
          join(target, "tests", "reference", scenario, `${image}.png`),
          "file",
        );
        const info = await lstat(source);
        if (info.size > MAX_PREVIEW_BYTES) {
          return fail(
            `That image is ${Math.round(info.size / 1024)} KiB: a preview may be 256 KiB at most.`,
          );
        }
        const size = await pngSize(source);
        if (!size) return fail("That file is not a PNG image.");
        // The destination folder must stay inside the project (no link out).
        const assets = await confinement.resolve(join(target, "assets"), "new-directory");
        const destination = join(assets, "preview.png");
        if (await lstat(destination).catch(() => undefined)) {
          return fail(
            "assets/preview.png already exists: this tool never replaces a file. Keep it, or delete it yourself first.",
          );
        }
        await mkdir(assets, { recursive: true });
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        const fourByThree =
          Math.abs(size.width * 3 - size.height * 4) <= Math.max(size.width, size.height) * 0.01;
        return ok(
          {
            directory: confinement.display(target),
            preview: "assets/preview.png",
            bytes: info.size,
            width: size.width,
            height: size.height,
            fourByThree,
            next: `Run check, package and prepare_submission. If the widget has a listing.json, add "preview": "assets/preview.png" to it.${fourByThree ? "" : " The image is not 4:3: the catalog shows it in a 4:3 box."}`,
          },
          `Copied ${scenario}/${image}.png to assets/preview.png (${size.width}×${size.height}, ${Math.round(info.size / 1024)} KiB).`,
          { redactor },
        );
      }),
  );
}
