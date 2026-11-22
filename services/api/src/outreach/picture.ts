import { randomUUID } from "node:crypto";
import { OWN_PICTURE_MAX_BYTES, OWN_PICTURE_TYPES, type OutreachAd, type OwnPictureType } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import { type Pictures, pictureType } from "../pictures/store.js";
import { optedOut, verdictOf } from "./stage.js";
import type { OutreachStore } from "./store.js";

/** Marks an ad as the owner's own upload, where an agent's ad names its batch. */
export const OWNER_AD = "owner";
const WHY = "Your own picture, uploaded from your computer.";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isOwnPicture = (type: string): type is OwnPictureType => Object.hasOwn(OWN_PICTURE_TYPES, type);
/** Where an upload waits until the studio has read it. The store empties this place after a day. */
const inboxKey = (prospectId: string, uploadId: string) => `outreach/inbox/${prospectId}/${uploadId}`;

interface Deps {
  store: OutreachStore;
  pictures: Pictures;
}

/**
 * The owner's own picture for a prospect: the ad he sends, or sent, with his first message, when it came from no studio batch.
 * Only the owner's session reaches this. His upload is his yes, so no second click is asked of him. No agent tool calls it.
 */
export class OwnPicture {
  constructor(private readonly deps: Deps) {}

  private async file(prospectId: string) {
    const { store } = this.deps;
    const [files, optOuts] = await Promise.all([store.all(), store.optOuts()]);
    const file = files.find((entry) => entry.profile.id === prospectId);
    if (!file) throw new Refusal(`There is no prospect ${prospectId}.`);
    if (optedOut(file, optOuts)) throw new Refusal("This contact opted out. No picture is kept for it, and no message should be sent.");
    return file;
  }

  /** The first step: an address that takes one file of exactly this type and size, for a few minutes. Nothing is saved here. */
  async start(prospectId: string, picture: { type: string; bytes: number }): Promise<{ uploadId: string; putUrl: string }> {
    if (!isOwnPicture(picture.type)) throw new Refusal("The picture is a JPEG or a PNG.");
    if (!Number.isInteger(picture.bytes) || picture.bytes < 1 || picture.bytes > OWN_PICTURE_MAX_BYTES) throw new Refusal("The picture can be up to 8 MB.");
    const file = await this.file(prospectId);
    const uploadId = randomUUID();
    return { uploadId, putUrl: await this.deps.pictures.putUrl(inboxKey(file.profile.id, uploadId), picture.type, picture.bytes) };
  }

  /**
   * The second step: the studio reads the file itself, keeps it only when its first bytes are a JPEG or a PNG, and attaches it as the prospect's newest ad with the owner's yes.
   * A second call for the same upload changes nothing.
   */
  async done(prospectId: string, uploadId: string): Promise<OutreachAd> {
    const { store, pictures } = this.deps;
    if (!ID.test(uploadId)) throw new Refusal("This is not the id of an upload.");
    const file = await this.file(prospectId);
    const id = file.profile.id;
    const inbox = inboxKey(id, uploadId);
    let ad = file.ads.find((entry) => entry.from === OWNER_AD && entry.imageId === uploadId);
    if (!ad) {
      // Two confirmations at the same moment both find no ad yet. Only the one that takes the upload attaches it.
      if (!(await store.claimUpload(id, uploadId))) throw new Refusal("This picture is being saved already. Open the page again in a moment.");
      try {
        const body = await pictures.read(inbox, OWN_PICTURE_MAX_BYTES);
        if (!body) throw new Refusal("The picture did not arrive, or it is over 8 MB. Choose it again.");
        const kind = pictureType(body);
        if (!kind || !isOwnPicture(kind.type)) {
          await pictures.remove(inbox);
          throw new Refusal("This file is not a JPEG or a PNG picture. Nothing of it was kept.");
        }
        // The kept copy is written before the ad names it, so an ad never points at a file that is not there.
        const key = `outreach/owner/${id}/${uploadId}.${kind.ext}`;
        await pictures.put(key, body, kind.type);
        ad = await store.addAd(id, { batchId: OWNER_AD, imageId: uploadId, from: OWNER_AD, key, why: WHY });
      } catch (error) {
        await store.releaseUpload(id, uploadId);
        throw error;
      }
    }
    if (!verdictOf(file, ad)) await store.addEvent(id, { type: "ad_yes", ad: ad.n }, "owner");
    await pictures.remove(inbox);
    return ad;
  }
}
