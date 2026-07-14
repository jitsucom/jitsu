import { FaArrowLeft } from "react-icons/fa";
import { Button, DatePicker, Form, Input, Modal, Radio, Table, Tag, Tooltip } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { useRouter } from "next/router";
import { useUser } from "../lib/context";
import { get, useApi } from "../lib/useApi";
import React, { useState } from "react";
import { ApiKey, inferTokenTypeFromId } from "../lib/schema";
import { copyTextToClipboard, feedbackError, feedbackSuccess, confirmOp } from "../lib/ui";
import { QueryResponse } from "../components/QueryResponse/QueryResponse";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { ChangePassword } from "../components/ChangePassword/ChangePassword";
import { FaCopy, FaPlus, FaTrash, FaTerminal, FaPencilAlt, FaPlug } from "react-icons/fa";
import { FaCloudArrowUp } from "react-icons/fa6";

/**
 * Expiration picker state for the create modal. Edit mode uses a plain
 * DatePicker instead and skips this enum.
 */
type ExpirationChoice = { kind: "30" | "60" | "90" } | { kind: "never" } | { kind: "custom"; date: Dayjs | null };

function choiceToDate(c: ExpirationChoice): Date | null {
  switch (c.kind) {
    case "never":
      return null;
    case "30":
    case "60":
    case "90": {
      const d = new Date();
      d.setDate(d.getDate() + Number(c.kind));
      return d;
    }
    case "custom":
      // The DatePicker emits a date-only Dayjs (midnight local). Snapping to
      // end-of-day means picking "today" yields an expiry ~24h out — without
      // it the token would be considered expired the instant it's saved
      // (getUser rejects when expiresAt < Date.now()).
      return c.date ? c.date.endOf("day").toDate() : null;
  }
}

const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

function fmtShortDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(undefined, dateFmt);
}

function fmtFullDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString();
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const d = typeof value === "string" ? new Date(value) : value;
  return d.getTime();
}

function effectiveType(key: ApiKey): string {
  // MCP-ness is inferred from the presence of mcpClientName (set when the
  // row is linked to an OAuthClient). We don't store type="mcp" on the row.
  if (key.mcpClientName) return "mcp";
  if (key.type) return key.type;
  return inferTokenTypeFromId(key.id);
}

const typeStyles: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  cli: { color: "blue", icon: <FaTerminal />, label: "cli" },
  api: { color: "purple", icon: <FaCloudArrowUp />, label: "api" },
  mcp: { color: "geekblue", icon: <FaPlug />, label: "mcp" },
};

function TypeTag({ type }: { type: string }) {
  const s = typeStyles[type] ?? { color: "default", icon: null, label: type };
  return (
    <Tag color={s.color} className="inline-flex items-center gap-1">
      {s.icon ? <span className="inline-flex items-center">{s.icon}</span> : null}
      <span>{s.label}</span>
    </Tag>
  );
}

/**
 * Middle-truncate `value` to at most `max` chars, preserving both ends. The
 * full string belongs in a tooltip beside the rendered span. Used for names —
 * common case is a long auto-generated id like `jitsu-cli-Tr78cBn6EHHorI0...`
 * where the prefix is informative but so is the trailing entropy.
 */
function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * `hint` from juava is `XXX*YYY` (3+1+3). Render as `XXX**********YYY` so the
 * masked secret looks like a sk- style preview without being so long it pushes
 * the table out.
 */
function renderSecretHint(hint: string | null | undefined): string {
  if (!hint) return "";
  const parts = hint.split("*");
  if (parts.length !== 2) return hint;
  return `${parts[0]}${"*".repeat(10)}${parts[1]}`;
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
      <Button
        type="text"
        size="small"
        onClick={() => {
          copyTextToClipboard(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <FaCopy />
      </Button>
    </Tooltip>
  );
};

const ExpirationField: React.FC<{
  value: ExpirationChoice;
  onChange: (next: ExpirationChoice) => void;
}> = ({ value, onChange }) => {
  const presetOptions: { label: string; kind: ExpirationChoice["kind"] }[] = [
    { label: "30 days", kind: "30" },
    { label: "60 days", kind: "60" },
    { label: "90 days", kind: "90" },
    { label: "Custom", kind: "custom" },
    { label: "Never", kind: "never" },
  ];
  const today = dayjs().startOf("day");
  return (
    <div className="flex flex-col gap-2">
      <Radio.Group
        value={value.kind}
        onChange={e => {
          const kind = e.target.value as ExpirationChoice["kind"];
          if (kind === "custom") {
            const seed = value.kind === "custom" ? value.date : dayjs().add(30, "day");
            onChange({ kind: "custom", date: seed });
          } else if (kind === "never") onChange({ kind: "never" });
          else onChange({ kind: kind as "30" | "60" | "90" });
        }}
        options={presetOptions.map(o => ({ label: o.label, value: o.kind }))}
        optionType="button"
      />
      {value.kind === "custom" && (
        <DatePicker
          value={value.date}
          onChange={d => onChange({ kind: "custom", date: d })}
          disabledDate={d => !!d && d.isBefore(today)}
          allowClear={false}
        />
      )}
    </div>
  );
};

type KeyModalProps =
  | {
      mode: "create";
      generated: { id: string; plaintext: string } | null;
      onSubmit: (vals: { name?: string; expiresAt: Date | null }) => Promise<void>;
      onClose: () => void;
    }
  | {
      mode: "edit";
      target: ApiKey;
      onSubmit: (vals: { name?: string | null; expiresAt?: Date | null }) => Promise<void>;
      onClose: () => void;
    };

const KeyModal: React.FC<KeyModalProps> = props => {
  const isCreate = props.mode === "create";
  const initialName = isCreate ? "" : props.target.name ?? "";
  const [name, setName] = useState(initialName);
  const [expiration, setExpiration] = useState<ExpirationChoice>({ kind: "90" });
  // Edit mode renders a plain DatePicker rather than the preset row. State is
  // a Dayjs (specific date) or null (never expires).
  const initialEditDate = !isCreate && props.target.expiresAt ? dayjs(props.target.expiresAt) : null;
  const [editDate, setEditDate] = useState<Dayjs | null>(initialEditDate);
  const [loading, setLoading] = useState(false);
  const generated = isCreate ? props.generated : null;

  const title = isCreate ? (generated ? "Save your secret key" : "Create new API key") : "Edit API key";

  const submit = async () => {
    setLoading(true);
    try {
      if (isCreate) {
        await props.onSubmit({ name: name.trim() || undefined, expiresAt: choiceToDate(expiration) });
      } else {
        // Edit mode: same end-of-day snap as create. The DatePicker is
        // date-only; without this, choosing "today" would mark the key
        // expired immediately.
        await props.onSubmit({
          name: name.trim() || null,
          expiresAt: editDate ? editDate.endOf("day").toDate() : null,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      title={title}
      maskClosable={!generated}
      closable={true}
      onCancel={props.onClose}
      footer={
        generated ? (
          <Button type="primary" onClick={props.onClose}>
            Done
          </Button>
        ) : (
          <div className="flex justify-end gap-2">
            <Button onClick={props.onClose}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={submit}>
              {isCreate ? "Create key" : "Save"}
            </Button>
          </div>
        )
      }
    >
      {generated ? (
        <div className="flex flex-col gap-3">
          <p>
            Copy and store this key in a safe place. <strong>You will not be able to see it again.</strong>
          </p>
          <div className="flex items-center font-mono text-xs bg-neutral-100 rounded px-2 py-1">
            <code className="break-all">
              {generated.id}:{generated.plaintext}
            </code>
            <CopyButton text={`${generated.id}:${generated.plaintext}`} />
          </div>
        </div>
      ) : (
        <Form layout="vertical">
          <Form.Item label="Name (optional)" help="A human-readable label. Leave blank to use the key id.">
            <Input
              placeholder="e.g. local dev / CI bot"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
            />
          </Form.Item>
          <Form.Item
            label="Expiration"
            help={
              !isCreate ? (editDate ? "Leave blank to remove the expiration." : "Cleared — key will never expire.") : ""
            }
          >
            {isCreate ? (
              <ExpirationField value={expiration} onChange={setExpiration} />
            ) : (
              <DatePicker
                value={editDate}
                onChange={setEditDate}
                disabledDate={d => !!d && d.isBefore(dayjs().startOf("day"))}
                placeholder="Never"
                allowClear
              />
            )}
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

type ModalState = { kind: "closed" } | { kind: "create" } | { kind: "edit"; target: ApiKey };

function ApiKeys() {
  const apiRes = useApi<ApiKey[]>("/api/user/keys");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [generated, setGenerated] = useState<{ id: string; plaintext: string } | null>(null);

  return (
    <QueryResponse
      result={apiRes}
      errorTitle={"Failed to load API keys"}
      render={keys => {
        const columns: any[] = [
          {
            title: "Name",
            key: "name",
            render: (k: ApiKey) => {
              const full = k.name || k.id;
              const display = middleTruncate(full, 32);
              return (
                <Tooltip title={full}>
                  <span className="font-medium">{display}</span>
                </Tooltip>
              );
            },
          },
          {
            title: "Type",
            key: "type",
            render: (k: ApiKey) => <TypeTag type={effectiveType(k)} />,
          },
          {
            title: "Key ID",
            key: "keyId",
            render: (k: ApiKey) => (
              <Tooltip title={k.id}>
                <code className="font-mono text-xs text-text-light">{middleTruncate(k.id, 22)}</code>
              </Tooltip>
            ),
          },
          {
            title: "Secret key",
            key: "secret",
            render: (k: ApiKey) => (
              <code className="font-mono text-xs text-text-light">{renderSecretHint(k.hint)}</code>
            ),
          },
          {
            title: <span className="whitespace-nowrap">Created</span>,
            dataIndex: "createdAt",
            className: "whitespace-nowrap",
            defaultSortOrder: "descend" as const,
            sorter: (a: ApiKey, b: ApiKey) => dateValue(a.createdAt) - dateValue(b.createdAt),
            render: (v: any) => (
              <Tooltip title={fmtFullDate(v)}>
                <span className="text-sm">{fmtShortDate(v)}</span>
              </Tooltip>
            ),
          },
          {
            title: <span className="whitespace-nowrap">Last used</span>,
            dataIndex: "lastUsed",
            className: "whitespace-nowrap",
            // Sort never-used keys last in descending mode (default 0 → bottom).
            sorter: (a: ApiKey, b: ApiKey) => dateValue(a.lastUsed) - dateValue(b.lastUsed),
            render: (v: any) =>
              v ? (
                <Tooltip title={fmtFullDate(v)}>
                  <span className="text-sm">{fmtShortDate(v)}</span>
                </Tooltip>
              ) : (
                <span className="text-text-light text-sm">Never</span>
              ),
          },
          {
            title: <span className="whitespace-nowrap">Expires</span>,
            dataIndex: "expiresAt",
            className: "whitespace-nowrap",
            sorter: (a: ApiKey, b: ApiKey) => dateValue(a.expiresAt) - dateValue(b.expiresAt),
            render: (v: any) => {
              if (!v) return <span className="text-text-light text-sm">Never</span>;
              const d = new Date(v);
              const expired = d.getTime() < Date.now();
              return (
                <Tooltip title={fmtFullDate(d)}>
                  <span className={`text-sm ${expired ? "text-error" : ""}`}>{fmtShortDate(d)}</span>
                </Tooltip>
              );
            },
          },
          {
            title: "",
            key: "actions",
            className: "text-right",
            width: 96,
            render: (k: ApiKey) => (
              <div className="inline-flex gap-1">
                <Tooltip title="Edit">
                  <Button type="text" size="small" onClick={() => setModal({ kind: "edit", target: k })}>
                    <FaPencilAlt />
                  </Button>
                </Tooltip>
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    onClick={async () => {
                      if (await confirmOp(`Delete key ${k.name || k.id}? This cannot be undone.`)) {
                        try {
                          await get(`/api/user/keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" });
                          await apiRes.reload();
                          feedbackSuccess("Key deleted");
                        } catch (e) {
                          feedbackError("Failed to delete key");
                        }
                      }
                    }}
                  >
                    <FaTrash />
                  </Button>
                </Tooltip>
              </div>
            ),
          },
        ];

        const closeModal = () => {
          setModal({ kind: "closed" });
          setGenerated(null);
        };
        return (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold m-0">API Keys</h2>
              <Button type="primary" icon={<FaPlus />} onClick={() => setModal({ kind: "create" })}>
                Create the key
              </Button>
            </div>
            <div className="pt-4">
              {keys.length === 0 ? (
                <div className="flex text-textDisabled justify-center py-6">
                  No API keys yet. Click "Create the key" to make one.
                </div>
              ) : (
                <Table size="middle" columns={columns} dataSource={keys} pagination={false} rowKey={k => k.id} />
              )}
            </div>
            {modal.kind === "create" && (
              <KeyModal
                mode="create"
                generated={generated}
                onSubmit={async vals => {
                  try {
                    const created = await get("/api/user/keys", {
                      method: "POST",
                      body: { name: vals.name, expiresAt: vals.expiresAt, type: "api" },
                    });
                    setGenerated({ id: created.id, plaintext: created.plaintext });
                    await apiRes.reload();
                    feedbackSuccess("API key created");
                  } catch (e) {
                    feedbackError("Failed to create key");
                  }
                }}
                onClose={closeModal}
              />
            )}
            {modal.kind === "edit" && (
              <KeyModal
                mode="edit"
                target={modal.target}
                onSubmit={async vals => {
                  try {
                    await get(`/api/user/keys?id=${encodeURIComponent(modal.target.id)}`, {
                      method: "PATCH",
                      body: vals,
                    });
                    await apiRes.reload();
                    feedbackSuccess("API key updated");
                    closeModal();
                  } catch (e) {
                    feedbackError("Failed to update key");
                  }
                }}
                onClose={closeModal}
              />
            )}
          </>
        );
      }}
    />
  );
}

const UserPage = (props: any) => {
  const router = useRouter();
  const user = useUser();
  return (
    <div className="flex justify-center">
      <div className="px-4 py-6 flex flex-col items-center w-full" style={{ maxWidth: "1440px", minWidth: "300px" }}>
        <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
          Go back
        </JitsuButton>
        <div className="w-full grow">
          <h1 className="flex-grow text-3xl py-6">User settings</h1>
          <div className="px-8 py-6 border border-textDisabled rounded-lg">
            <label htmlFor="email" className="text-lg font-bold">
              Email
            </label>
            <div className="mt-3">
              <Input id="email" value={user.email} className="border-error" />

              <p className="text-textDisabled">
                You can't change email, since you logged in with an external user provider - {user.loginProvider}
              </p>
            </div>
          </div>
          {user.loginProvider === "credentials" && <ChangePassword />}
          <div className="px-8 py-6 border border-textDisabled rounded-lg mt-6">
            <ApiKeys />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserPage;
