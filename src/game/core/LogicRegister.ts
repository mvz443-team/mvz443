/**
 * 逻辑寄存器：实体可序列化状态的唯一来源。
 *
 * - Model 声明寄存器表（名字/类型/默认值），实体按 schema 分配一组寄存器。
 * - 业务逻辑通过实体上的同名访问器读写寄存器（见 bindLogicRegisters）。
 * - 快照只序列化一个按声明顺序排列的数组，不做对象字段反射，体积和开销都更小。
 *
 * 本文件不依赖 Phaser / Rapier，可在 Node 下独立测试。
 */

export type RegisterValue = number | boolean | string;
export type RegisterType = "f64" | "i32" | "bool" | "str";

export interface LogicRegisterDecl {
  /** 寄存器名，同时也是实体上的访问器名 */
  name: string;
  type: RegisterType;
  default: RegisterValue;
  /** 是否参与跨端哈希；纯本地调试字段可设 false */
  hashed?: boolean;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export class RegisterSchema {
  public readonly decls: readonly LogicRegisterDecl[];
  /** schema 指纹：用于检测快照与当前代码的寄存器表是否兼容 */
  public readonly fingerprint: string;
  private readonly indexByName: Map<string, number>;

  constructor(decls: readonly LogicRegisterDecl[]) {
    const indexByName = new Map<string, number>();
    const normalized: LogicRegisterDecl[] = [];
    for (const decl of decls) {
      if (indexByName.has(decl.name)) {
        throw new Error(`[LogicRegister] 寄存器重复声明: ${decl.name}`);
      }
      indexByName.set(decl.name, normalized.length);
      normalized.push(Object.freeze({ ...decl }));
    }
    this.decls = Object.freeze(normalized);
    this.indexByName = indexByName;
    this.fingerprint = fnv1a(this.decls.map((decl) => `${decl.name}:${decl.type}`).join("|"));
  }

  public indexOf(name: string): number {
    return this.indexByName.get(name) ?? -1;
  }

  public has(name: string): boolean {
    return this.indexByName.has(name);
  }

  public createBank(): RegisterBank {
    return new RegisterBank(this);
  }
}

function coerce(type: RegisterType, value: unknown): RegisterValue {
  switch (type) {
    case "i32":
      return Math.trunc(Number(value)) | 0;
    case "f64":
      return Number(value);
    case "bool":
      return Boolean(value);
    case "str":
      return typeof value === "string" ? value : String(value ?? "");
    default:
      return value as RegisterValue;
  }
}

/**
 * 一个实体实例的寄存器组。
 * values 按 schema 声明顺序排列，capture/restore 直接读写该数组。
 */
export class RegisterBank {
  public readonly schema: RegisterSchema;
  private readonly values: RegisterValue[];

  constructor(schema: RegisterSchema) {
    this.schema = schema;
    this.values = schema.decls.map((decl) => decl.default);
  }

  public get(name: string): RegisterValue | undefined {
    const index = this.schema.indexOf(name);
    return index < 0 ? undefined : this.values[index];
  }

  public set(name: string, value: unknown): boolean {
    const index = this.schema.indexOf(name);
    if (index < 0) return false;
    this.values[index] = coerce(this.schema.decls[index].type, value);
    return true;
  }

  public has(name: string): boolean {
    return this.schema.has(name);
  }

  /** 按声明顺序导出；恢复时可直接写回。 */
  public capture(): RegisterValue[] {
    return [...this.values];
  }

  /** 恢复寄存器；长度不一致时返回 false，由调用方记录 missing。 */
  public restore(values: readonly RegisterValue[]): boolean {
    if (values.length !== this.values.length) return false;
    for (let i = 0; i < values.length; i++) {
      this.values[i] = coerce(this.schema.decls[i].type, values[i]);
    }
    return true;
  }

  /** 仅重置为默认值（重建实体的初始状态）。 */
  public reset(): void {
    for (let i = 0; i < this.values.length; i++) {
      this.values[i] = this.schema.decls[i].default;
    }
  }

  public toObject(): Record<string, RegisterValue> {
    const out: Record<string, RegisterValue> = {};
    for (let i = 0; i < this.schema.decls.length; i++) {
      out[this.schema.decls[i].name] = this.values[i];
    }
    return out;
  }
}

/**
 * 把 schema 中的寄存器以同名属性访问器安装到实体上。
 * 若实体上已存在同名数据字段，会先把它当前值迁入寄存器，再用访问器替换，
 * 从而让既有业务代码（this.foo）无需修改即可走寄存器存储。
 */
export function bindRegistersToEntity(entity: object, bank: RegisterBank): void {
  const obj = entity as Record<string, unknown>;

  for (const decl of bank.schema.decls) {
    const name = decl.name;
    const descriptor = Object.getOwnPropertyDescriptor(obj, name);
    let initial: unknown;
    let hasInitial = false;

    if (descriptor) {
      if ("value" in descriptor) {
        initial = descriptor.value;
        hasInitial = initial !== undefined;
      }
    } else if (name in obj) {
      initial = obj[name];
      hasInitial = initial !== undefined;
    }

    if (hasInitial) bank.set(name, initial);

    Object.defineProperty(obj, name, {
      configurable: true,
      enumerable: true,
      get: () => bank.get(name),
      set: (value: unknown) => { bank.set(name, value); },
    });
  }
}
