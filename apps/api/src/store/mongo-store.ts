import mongoose, { Schema } from "mongoose";
import type { KitRecord, Store, UserRecord } from "./types.js";

const UserSchema = new Schema({ email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true } }, { timestamps: true });

const KitSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    title: String,
    inputHash: { type: String, index: true },
    input: { jd: String, company_url: String, days: Number },
    status: { type: String, enum: ["queued", "running", "ready", "failed"], index: true },
    // The kit itself is validated by Zod (validateKit) before every save, so Mongo stores it as a document.
    kit: { type: Schema.Types.Mixed, default: null },
    context: { type: Schema.Types.Mixed, default: null },
    events: { type: [Schema.Types.Mixed], default: [] },
    error: { type: Schema.Types.Mixed, default: null },
    version: { type: Number, default: 0 },
    practice: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, minimize: false },
);
KitSchema.index({ userId: 1, inputHash: 1, createdAt: -1 });

const UserModel = mongoose.models.User ?? mongoose.model("User", UserSchema);
const KitModel = mongoose.models.Kit ?? mongoose.model("Kit", KitSchema);

const toUser = (d: any): UserRecord => ({ id: String(d._id), email: d.email, passwordHash: d.passwordHash, createdAt: new Date(d.createdAt).toISOString() });
const toKit = (d: any): KitRecord => ({
  id: String(d._id),
  userId: d.userId,
  title: d.title,
  inputHash: d.inputHash,
  input: d.input,
  status: d.status,
  kit: d.kit ?? null,
  context: d.context ?? null,
  events: d.events ?? [],
  error: d.error ?? null,
  version: d.version ?? 0,
  practice: d.practice ?? [],
  createdAt: new Date(d.createdAt).toISOString(),
  updatedAt: new Date(d.updatedAt).toISOString(),
});
const validId = (id: string) => mongoose.isValidObjectId(id);

export class MongoStore implements Store {
  static async connect(uri: string): Promise<MongoStore> {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    return new MongoStore();
  }
  async createUser(email: string, passwordHash: string) {
    return toUser(await UserModel.create({ email, passwordHash }));
  }
  async findUserByEmail(email: string) {
    const d = await UserModel.findOne({ email }).lean();
    return d ? toUser(d) : null;
  }
  async findUserById(id: string) {
    if (!validId(id)) return null;
    const d = await UserModel.findById(id).lean();
    return d ? toUser(d) : null;
  }
  async createKit(rec: Omit<KitRecord, "id" | "createdAt" | "updatedAt">) {
    return toKit((await KitModel.create(rec)).toObject());
  }
  async getKit(id: string, userId: string) {
    if (!validId(id)) return null;
    const d = await KitModel.findOne({ _id: id, userId }).lean();
    return d ? toKit(d) : null;
  }
  async getKitById(id: string) {
    if (!validId(id)) return null;
    const d = await KitModel.findById(id).lean();
    return d ? toKit(d) : null;
  }
  async listKits(userId: string) {
    return (await KitModel.find({ userId }).sort({ createdAt: -1 }).select({ context: 0, events: 0 }).lean()).map(toKit);
  }
  async findActiveByHash(userId: string, hash: string) {
    const d = await KitModel.findOne({ userId, inputHash: hash, status: { $ne: "failed" } }).sort({ createdAt: -1 }).lean();
    return d ? toKit(d) : null;
  }
  async updateKit(id: string, patch: Partial<KitRecord>, expectedVersion?: number) {
    if (!validId(id)) return null;
    const { id: _i, createdAt: _c, updatedAt: _u, version: _v, ...set } = patch as any;
    const filter: Record<string, unknown> = { _id: id };
    if (expectedVersion !== undefined) filter.version = expectedVersion;
    const update: Record<string, unknown> = { $set: set };
    if (patch.kit !== undefined) update.$inc = { version: 1 };
    const d = await KitModel.findOneAndUpdate(filter, update, { new: true }).lean();
    return d ? toKit(d) : null;
  }
  async pushEvent(id: string, e: KitRecord["events"][number]) {
    if (validId(id)) await KitModel.updateOne({ _id: id }, { $push: { events: e } });
  }
  async deleteKit(id: string, userId: string) {
    if (!validId(id)) return false;
    return (await KitModel.deleteOne({ _id: id, userId })).deletedCount === 1;
  }
  async listUnfinished() {
    return (await KitModel.find({ status: { $in: ["queued", "running"] } }).lean()).map(toKit);
  }
}
