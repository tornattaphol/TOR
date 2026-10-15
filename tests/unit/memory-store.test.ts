import { MemoryDrawStore } from "../../src/lib/db/memory-store";
import { runStoreContract } from "../helpers/store-contract";

runStoreContract("MemoryDrawStore", async () => new MemoryDrawStore());
