"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Typography,
  type MenuProps
} from "antd";

interface Transaction {
  id: string;
  accountName: string;
  merchantName: string | null;
  description: string;
  amount: string;
  currencyCode: string;
  transactionDate: string;
  categoryName: string | null;
  pending: boolean;
  isExcluded: boolean;
}

interface TransactionsResponse {
  data: Transaction[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
}

interface Category {
  id: string;
  name: string;
}

interface Rule {
  id: string;
  categoryId: string;
  categoryName?: string;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  isActive: boolean;
}

interface BudgetProgress {
  budgetId: string;
  budgetName: string;
  period: "WEEKLY" | "MONTHLY";
  periodStartDate: string;
  periodEndDate: string;
  amount: string;
  spent: string;
  remaining: string;
  progressRatio: number;
  paceRatio: number;
}

interface BudgetRecord {
  id: string;
  name: string;
  period: "WEEKLY" | "MONTHLY";
  amount: string;
  categoryId: string | null;
  categoryName: string | null;
  isActive: boolean;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  includeExcludedTransactions: boolean;
}

type ReportDurationPreset =
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "CUSTOM";

interface ReportLineItem {
  id: string;
  transaction_date: string;
  merchant_name: string | null;
  original_description: string;
  amount: string;
  is_excluded: boolean;
  account_name: string;
  category_name: string | null;
}

interface ReportQueryResponse {
  totals: {
    spent: string;
    income: string;
    net: string;
  };
  data: ReportLineItem[];
}

interface AuthResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
  csrfToken: string;
}

interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const BUDGET_PERIOD_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" }
] as const;

const RULE_FIELD_OPTIONS = [
  { value: "MERCHANT_NAME", label: "Merchant" },
  { value: "ORIGINAL_DESCRIPTION", label: "Description" },
  { value: "ACCOUNT_NAME", label: "Account" },
  { value: "MCC", label: "MCC" },
  { value: "PLAID_DETAILED_CATEGORY", label: "Plaid Detailed" },
  { value: "PLAID_PRIMARY_CATEGORY", label: "Plaid Primary" }
] as const;

const RULE_OPERATOR_OPTIONS = [
  { value: "EQUALS", label: "Equals" },
  { value: "CONTAINS", label: "Contains" },
  { value: "STARTS_WITH", label: "Starts With" },
  { value: "ENDS_WITH", label: "Ends With" },
  { value: "REGEX", label: "Regex" }
] as const;

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string) => void | Promise<void>;
        onExit?: (error: { error_message?: string } | null) => void;
      }) => {
        open: () => void;
      };
    };
  }
}

function formatMoney(amount: string, currencyCode: string) {
  const numeric = Number(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode
  }).format(numeric);
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function lastDayOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function rangeForPreset(preset: ReportDurationPreset) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  if (preset === "LAST_7_DAYS") {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
  }

  if (preset === "LAST_30_DAYS") {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
  }

  if (preset === "THIS_MONTH") {
    return {
      startDate: toDateInputValue(firstDayOfMonth(end)),
      endDate: toDateInputValue(end)
    };
  }

  if (preset === "LAST_MONTH") {
    const currentMonthStart = firstDayOfMonth(end);
    const previousMonthEnd = new Date(currentMonthStart);
    previousMonthEnd.setUTCDate(0);
    const previousMonthStart = firstDayOfMonth(previousMonthEnd);
    return {
      startDate: toDateInputValue(previousMonthStart),
      endDate: toDateInputValue(lastDayOfMonth(previousMonthStart))
    };
  }

  return {
    startDate: toDateInputValue(end),
    endDate: toDateInputValue(end)
  };
}

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [showTransactionFilters, setShowTransactionFilters] = useState(false);
  const [showReportFilters, setShowReportFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "transactions" | "budgets" | "rules" | "reports"
  >("transactions");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [currentUser, setCurrentUser] = useState<{
    email: string;
    displayName: string | null;
  } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [sortBy, setSortBy] = useState("transaction_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionsResponse | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [plaidMessage, setPlaidMessage] = useState<string | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<BudgetProgress[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  const [budgetRecords, setBudgetRecords] = useState<BudgetRecord[]>([]);
  const [budgetRecordsLoading, setBudgetRecordsLoading] = useState(false);
  const [budgetRecordsError, setBudgetRecordsError] = useState<string | null>(null);
  const [budgetActionLoading, setBudgetActionLoading] = useState(false);
  const [budgetActionError, setBudgetActionError] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editBudgetForm, setEditBudgetForm] = useState({
    name: "",
    period: "WEEKLY" as "WEEKLY" | "MONTHLY",
    amount: "",
    categoryId: "",
    isActive: true,
    effectiveStartDate: "",
    effectiveEndDate: "",
    includeExcludedTransactions: false
  });
  const [budgetCreateLoading, setBudgetCreateLoading] = useState(false);
  const [budgetCreateError, setBudgetCreateError] = useState<string | null>(null);
  const [budgetCreateMessage, setBudgetCreateMessage] = useState<string | null>(null);
  const [budgetForm, setBudgetForm] = useState({
    name: "",
    period: "WEEKLY" as "WEEKLY" | "MONTHLY",
    amount: "",
    categoryId: "",
    effectiveStartDate: new Date().toISOString().slice(0, 10),
    effectiveEndDate: "",
    includeExcludedTransactions: false
  });
  const initialReportRange = rangeForPreset("LAST_30_DAYS");
  const [reportPreset, setReportPreset] =
    useState<ReportDurationPreset>("LAST_30_DAYS");
  const [reportStartDate, setReportStartDate] = useState(initialReportRange.startDate);
  const [reportEndDate, setReportEndDate] = useState(initialReportRange.endDate);
  const [reportCategoryIds, setReportCategoryIds] = useState<string[]>([]);
  const [reportIncludeExcluded, setReportIncludeExcluded] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<ReportQueryResponse | null>(null);
  const [newRule, setNewRule] = useState({
    categoryId: "",
    field: "MERCHANT_NAME",
    operator: "EQUALS",
    pattern: "",
    priority: 100
  });

  const query = useMemo(() => {
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", String(pageSize));
    q.set("sortBy", sortBy);
    q.set("sortOrder", sortOrder);
    q.set("includeExcluded", includeExcluded ? "true" : "false");
    if (search.trim()) {
      q.set("search", search.trim());
    }
    return q.toString();
  }, [includeExcluded, page, pageSize, search, sortBy, sortOrder]);

  async function apiFetch(path: string, init?: RequestInit) {
    const method = (init?.method ?? "GET").toUpperCase();
    const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);
    const headers = new Headers(init?.headers ?? undefined);
    if (needsCsrf && csrfToken) {
      headers.set("x-csrf-token", csrfToken);
    }
    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include"
    });
  }

  const transactionColumns = useMemo(
    () => [
      { title: "Date", dataIndex: "transactionDate", key: "transactionDate" },
      {
        title: "Merchant",
        dataIndex: "merchantName",
        key: "merchantName",
        render: (value: string | null) => value ?? "-"
      },
      { title: "Description", dataIndex: "description", key: "description" },
      { title: "Account", dataIndex: "accountName", key: "accountName" },
      {
        title: "Category",
        dataIndex: "categoryName",
        key: "categoryName",
        render: (value: string | null) => value ?? "Uncategorized"
      },
      {
        title: "Amount",
        dataIndex: "amount",
        key: "amount",
        render: (value: string, row: Transaction) =>
          formatMoney(value, row.currencyCode)
      },
      {
        title: "Status",
        key: "status",
        render: (_: unknown, row: Transaction) =>
          row.pending
            ? row.isExcluded
              ? "Pending · Excluded"
              : "Pending"
            : row.isExcluded
              ? "Posted · Excluded"
              : "Posted"
      }
    ],
    []
  );

  const reportColumns = useMemo(
    () => [
      { title: "Date", dataIndex: "transaction_date", key: "transaction_date" },
      {
        title: "Merchant",
        dataIndex: "merchant_name",
        key: "merchant_name",
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Description",
        dataIndex: "original_description",
        key: "original_description"
      },
      { title: "Account", dataIndex: "account_name", key: "account_name" },
      {
        title: "Category",
        dataIndex: "category_name",
        key: "category_name",
        render: (value: string | null) => value ?? "Uncategorized"
      },
      {
        title: "Amount",
        dataIndex: "amount",
        key: "amount",
        render: (value: string) => formatMoney(value, "USD")
      },
      {
        title: "Status",
        dataIndex: "is_excluded",
        key: "is_excluded",
        render: (isExcluded: boolean) => (isExcluded ? "Excluded" : "Included")
      }
    ],
    []
  );

  const budgetColumns = useMemo(
    () => [
      {
        title: "Name",
        key: "name",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Input
              value={editBudgetForm.name}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
            />
          ) : (
            budget.name
          )
      },
      {
        title: "Period",
        key: "period",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Select
              value={editBudgetForm.period}
              options={[...BUDGET_PERIOD_OPTIONS]}
              onChange={(value) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  period: value as "WEEKLY" | "MONTHLY"
                }))
              }
            />
          ) : (
            budget.period
          )
      },
      {
        title: "Amount",
        key: "amount",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Input
              type="number"
              min={0}
              step="0.01"
              value={editBudgetForm.amount}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  amount: event.target.value
                }))
              }
            />
          ) : (
            formatMoney(budget.amount, "USD")
          )
      },
      {
        title: "Category",
        key: "category",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Select
              value={editBudgetForm.categoryId}
              options={[
                { value: "", label: "Overall" },
                ...categories.map((category) => ({
                  value: category.id,
                  label: category.name
                }))
              ]}
              onChange={(value) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  categoryId: value
                }))
              }
            />
          ) : (
            budget.categoryName ?? "Overall"
          )
      },
      {
        title: "Start",
        key: "effectiveStartDate",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Input
              type="date"
              value={editBudgetForm.effectiveStartDate}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  effectiveStartDate: event.target.value
                }))
              }
            />
          ) : (
            budget.effectiveStartDate
          )
      },
      {
        title: "End",
        key: "effectiveEndDate",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Input
              type="date"
              value={editBudgetForm.effectiveEndDate}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  effectiveEndDate: event.target.value
                }))
              }
            />
          ) : (
            budget.effectiveEndDate ?? "-"
          )
      },
      {
        title: "Active",
        key: "isActive",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Checkbox
              checked={editBudgetForm.isActive}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  isActive: event.target.checked
                }))
              }
            />
          ) : budget.isActive ? (
            "Yes"
          ) : (
            "No"
          )
      },
      {
        title: "Include Excluded",
        key: "includeExcludedTransactions",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Checkbox
              checked={editBudgetForm.includeExcludedTransactions}
              onChange={(event) =>
                setEditBudgetForm((current) => ({
                  ...current,
                  includeExcludedTransactions: event.target.checked
                }))
              }
            />
          ) : budget.includeExcludedTransactions ? (
            "Yes"
          ) : (
            "No"
          )
      },
      {
        title: "Actions",
        key: "actions",
        render: (_: unknown, budget: BudgetRecord) =>
          editingBudgetId === budget.id ? (
            <Space>
              <Button
                type="primary"
                size="small"
                loading={budgetActionLoading}
                onClick={() => void saveBudgetEdit(budget.id)}
              >
                Save
              </Button>
              <Button
                size="small"
                disabled={budgetActionLoading}
                onClick={cancelEditBudget}
              >
                Cancel
              </Button>
            </Space>
          ) : (
            <Space>
              <Button
                size="small"
                disabled={budgetActionLoading}
                onClick={() => startEditBudget(budget)}
              >
                Edit
              </Button>
              <Button
                danger
                size="small"
                disabled={budgetActionLoading}
                onClick={() => void deleteBudget(budget.id)}
              >
                Delete
              </Button>
            </Space>
          )
      }
    ],
    [
      budgetActionLoading,
      cancelEditBudget,
      categories,
      deleteBudget,
      editBudgetForm.amount,
      editBudgetForm.categoryId,
      editBudgetForm.effectiveEndDate,
      editBudgetForm.effectiveStartDate,
      editBudgetForm.includeExcludedTransactions,
      editBudgetForm.isActive,
      editBudgetForm.name,
      editBudgetForm.period,
      editingBudgetId,
      saveBudgetEdit,
      startEditBudget
    ]
  );

  const ruleColumns = useMemo(
    () => [
      {
        title: "Active",
        key: "isActive",
        render: (_: unknown, rule: Rule) => (
          <Checkbox
            checked={rule.isActive}
            onChange={(event) =>
              void patchRule(rule.id, { isActive: event.target.checked })
            }
          />
        )
      },
      {
        title: "Category",
        key: "categoryId",
        render: (_: unknown, rule: Rule) => (
          <Select
            value={rule.categoryId}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name
            }))}
            onChange={(value) =>
              setRules((current) =>
                current.map((row) =>
                  row.id === rule.id ? { ...row, categoryId: value } : row
                )
              )
            }
          />
        )
      },
      {
        title: "Field",
        key: "field",
        render: (_: unknown, rule: Rule) => (
          <Select
            value={rule.field}
            options={[...RULE_FIELD_OPTIONS]}
            onChange={(value) =>
              setRules((current) =>
                current.map((row) =>
                  row.id === rule.id ? { ...row, field: value } : row
                )
              )
            }
          />
        )
      },
      {
        title: "Operator",
        key: "operator",
        render: (_: unknown, rule: Rule) => (
          <Select
            value={rule.operator}
            options={[...RULE_OPERATOR_OPTIONS]}
            onChange={(value) =>
              setRules((current) =>
                current.map((row) =>
                  row.id === rule.id ? { ...row, operator: value } : row
                )
              )
            }
          />
        )
      },
      {
        title: "Pattern",
        key: "pattern",
        render: (_: unknown, rule: Rule) => (
          <Input
            value={rule.pattern}
            onChange={(event) =>
              setRules((current) =>
                current.map((row) =>
                  row.id === rule.id ? { ...row, pattern: event.target.value } : row
                )
              )
            }
          />
        )
      },
      {
        title: "Priority",
        key: "priority",
        render: (_: unknown, rule: Rule) => (
          <Input
            type="number"
            min={1}
            max={10000}
            value={String(rule.priority)}
            onChange={(event) =>
              setRules((current) =>
                current.map((row) =>
                  row.id === rule.id
                    ? { ...row, priority: Number(event.target.value) }
                    : row
                )
              )
            }
          />
        )
      },
      {
        title: "Actions",
        key: "actions",
        render: (_: unknown, rule: Rule) => (
          <Space>
            <Button
              size="small"
              onClick={() =>
                void patchRule(rule.id, {
                  categoryId: rule.categoryId,
                  field: rule.field,
                  operator: rule.operator,
                  pattern: rule.pattern,
                  priority: rule.priority,
                  isActive: rule.isActive
                })
              }
            >
              Save
            </Button>
            <Button danger size="small" onClick={() => void deleteRule(rule.id)}>
              Delete
            </Button>
          </Space>
        )
      }
    ],
    [categories]
  );

  useEffect(() => {
    function updateMobileState() {
      setIsMobile(window.innerWidth <= 768);
    }
    updateMobileState();
    window.addEventListener("resize", updateMobileState);
    return () => window.removeEventListener("resize", updateMobileState);
  }, []);

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await apiFetch("/auth/me");
        if (!response.ok) {
          throw new Error("Failed to load current user");
        }
        const payload = (await response.json()) as {
          email: string;
          displayName: string | null;
          csrfToken: string;
        };
        setCurrentUser({
          email: payload.email,
          displayName: payload.displayName
        });
        setCsrfToken(payload.csrfToken);
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
        setCsrfToken("");
        setCurrentUser(null);
      }
    }

    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setResult(null);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await apiFetch(`/transactions?${query}`);

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const json = (await response.json()) as TransactionsResponse;
        setResult(json);
      } catch (loadError) {
        setResult(null);
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load data"
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [query, isAuthenticated, refreshNonce]);

  useEffect(() => {
    if (!isAuthenticated) {
      setBudgets([]);
      return;
    }

    async function loadBudgets() {
      setBudgetsLoading(true);
      setBudgetsError(null);
      try {
        const response = await apiFetch("/budgets/progress");
        if (!response.ok) {
          throw new Error(`Budget request failed (${response.status})`);
        }
        const payload = (await response.json()) as { data: BudgetProgress[] };
        setBudgets(payload.data);
      } catch (loadError) {
        setBudgetsError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load budget progress"
        );
      } finally {
        setBudgetsLoading(false);
      }
    }

    void loadBudgets();
  }, [isAuthenticated, refreshNonce]);

  useEffect(() => {
    if (!isAuthenticated) {
      setBudgetRecords([]);
      return;
    }

    async function loadBudgetRecords() {
      setBudgetRecordsLoading(true);
      setBudgetRecordsError(null);
      try {
        const response = await apiFetch("/budgets?includeInactive=true");
        if (!response.ok) {
          throw new Error(`Budget list request failed (${response.status})`);
        }
        const payload = (await response.json()) as { data: BudgetRecord[] };
        setBudgetRecords(payload.data);
      } catch (loadError) {
        setBudgetRecordsError(
          loadError instanceof Error ? loadError.message : "Failed to load budgets"
        );
      } finally {
        setBudgetRecordsLoading(false);
      }
    }

    void loadBudgetRecords();
  }, [isAuthenticated, refreshNonce]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRules([]);
      setCategories([]);
      return;
    }

    async function loadRulesAndCategories() {
      setRulesLoading(true);
      setRulesError(null);
      try {
        const [rulesRes, categoriesRes] = await Promise.all([
          apiFetch("/rules"),
          apiFetch("/categories")
        ]);
        if (!rulesRes.ok || !categoriesRes.ok) {
          throw new Error("Failed to load rules/categories");
        }

        const rulesJson = (await rulesRes.json()) as { data: Rule[] };
        const categoriesJson = (await categoriesRes.json()) as { data: Category[] };
        setRules(rulesJson.data);
        setCategories(categoriesJson.data);
        if (!newRule.categoryId && categoriesJson.data[0]) {
          setNewRule((prev) => ({
            ...prev,
            categoryId: categoriesJson.data[0]?.id ?? ""
          }));
        }
      } catch (loadError) {
        setRulesError(
          loadError instanceof Error ? loadError.message : "Failed to load rules"
        );
      } finally {
        setRulesLoading(false);
      }
    }

    void loadRulesAndCategories();
  }, [isAuthenticated]);

  async function createRule() {
    if (!isAuthenticated || !newRule.categoryId || !newRule.pattern.trim()) {
      return;
    }

    setRulesError(null);
    const response = await apiFetch("/rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...newRule,
        pattern: newRule.pattern.trim()
      })
    });
    if (!response.ok) {
      setRulesError(`Failed to create rule (${response.status})`);
      return;
    }
    const created = (await response.json()) as Rule;
    setRules((current) => [...current, created]);
    setNewRule((prev) => ({ ...prev, pattern: "" }));
  }

  async function patchRule(ruleId: string, patch: Partial<Rule>) {
    if (!isAuthenticated) {
      return;
    }
    setRulesError(null);
    const response = await apiFetch(`/rules/${ruleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(patch)
    });
    if (!response.ok) {
      setRulesError(`Failed to update rule (${response.status})`);
      return;
    }
    const updated = (await response.json()) as Rule;
    setRules((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, ...updated } : rule))
    );
  }

  async function deleteRule(ruleId: string) {
    if (!isAuthenticated) {
      return;
    }
    setRulesError(null);
    const response = await apiFetch(`/rules/${ruleId}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      setRulesError(`Failed to delete rule (${response.status})`);
      return;
    }
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
  }

  async function ensurePlaidScriptLoaded() {
    if (window.Plaid) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        "script[data-plaid-link='true']"
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load Plaid script")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      script.async = true;
      script.dataset.plaidLink = "true";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("Failed to load Plaid script")),
        { once: true }
      );
      document.head.appendChild(script);
    });
  }

  async function connectPlaid() {
    if (!isAuthenticated) {
      setPlaidError("Sign in before connecting Plaid.");
      return;
    }

    setPlaidLoading(true);
    setPlaidError(null);
    setPlaidMessage(null);

    try {
      const createLinkTokenRes = await apiFetch("/plaid/create-link-token", {
        method: "POST"
      });
      if (!createLinkTokenRes.ok) {
        throw new Error(`Failed to create link token (${createLinkTokenRes.status})`);
      }

      const createLinkTokenJson = (await createLinkTokenRes.json()) as {
        linkToken: string;
      };

      await ensurePlaidScriptLoaded();
      const plaid = window.Plaid;
      if (!plaid) {
        throw new Error("Plaid SDK did not initialize");
      }

      const handler = plaid.create({
        token: createLinkTokenJson.linkToken,
        onSuccess: async (publicToken: string) => {
          setPlaidMessage("Plaid account linked. Syncing transactions...");
          setPlaidError(null);

          try {
            const exchangeRes = await apiFetch("/plaid/exchange-public-token", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ publicToken })
            });
            if (!exchangeRes.ok) {
              throw new Error(`Exchange failed (${exchangeRes.status})`);
            }

            const syncRes = await apiFetch("/plaid/transactions/sync", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({})
            });
            if (!syncRes.ok) {
              throw new Error(`Initial sync failed (${syncRes.status})`);
            }

            setPlaidMessage("Plaid sync complete. Transactions refreshed.");
            setRefreshNonce((current) => current + 1);
          } catch (syncError) {
            setPlaidError(
              syncError instanceof Error
                ? syncError.message
                : "Failed to link/sync Plaid"
            );
          } finally {
            setPlaidLoading(false);
          }
        },
        onExit: (exitError) => {
          if (exitError?.error_message) {
            setPlaidError(exitError.error_message);
          }
          setPlaidLoading(false);
        }
      });

      handler.open();
    } catch (connectError) {
      setPlaidError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to start Plaid Link"
      );
      setPlaidLoading(false);
    }
  }

  async function syncNow() {
    if (!isAuthenticated) {
      setPlaidError("Sign in before syncing.");
      return;
    }

    setSyncLoading(true);
    setPlaidError(null);
    setPlaidMessage(null);
    try {
      const incrementalResponse = await apiFetch("/plaid/transactions/sync-incremental", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      if (!incrementalResponse.ok) {
        const fullSyncResponse = await apiFetch("/plaid/transactions/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ days: 90 })
        });

        if (!fullSyncResponse.ok) {
          const payload = (await incrementalResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? `Sync failed (${incrementalResponse.status})`);
        }

        const nowIso = new Date().toISOString();
        setLastSyncedAt(nowIso);
        setPlaidMessage("Full sync complete. Transactions refreshed.");
        setRefreshNonce((current) => current + 1);
        return;
      }
      const nowIso = new Date().toISOString();
      setLastSyncedAt(nowIso);
      setPlaidMessage("Sync complete. Transactions refreshed.");
      setRefreshNonce((current) => current + 1);
    } catch (error) {
      setPlaidError(error instanceof Error ? error.message : "Failed to sync transactions");
    } finally {
      setSyncLoading(false);
    }
  }

  async function createBudget() {
    if (!isAuthenticated) {
      return;
    }

    const amount = Number(budgetForm.amount);
    if (!budgetForm.name.trim()) {
      setBudgetCreateError("Budget name is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setBudgetCreateError("Amount must be a non-negative number.");
      return;
    }
    if (!budgetForm.effectiveStartDate) {
      setBudgetCreateError("Effective start date is required.");
      return;
    }
    if (
      budgetForm.effectiveEndDate &&
      budgetForm.effectiveEndDate < budgetForm.effectiveStartDate
    ) {
      setBudgetCreateError(
        "Effective end date cannot be before effective start date."
      );
      return;
    }

    setBudgetCreateLoading(true);
    setBudgetCreateError(null);
    setBudgetCreateMessage(null);

    try {
      const response = await apiFetch("/budgets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: budgetForm.name.trim(),
          period: budgetForm.period,
          amount,
          categoryId: budgetForm.categoryId || null,
          effectiveStartDate: budgetForm.effectiveStartDate,
          effectiveEndDate: budgetForm.effectiveEndDate || null,
          includeExcludedTransactions: budgetForm.includeExcludedTransactions
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `Failed to create budget (${response.status})`);
      }

      setBudgetCreateMessage("Budget created.");
      setBudgetForm((current) => ({
        ...current,
        name: "",
        amount: "",
        effectiveEndDate: ""
      }));
      setRefreshNonce((current) => current + 1);
    } catch (createError) {
      setBudgetCreateError(
        createError instanceof Error ? createError.message : "Failed to create budget"
      );
    } finally {
      setBudgetCreateLoading(false);
    }
  }

  function startEditBudget(budget: BudgetRecord) {
    setEditingBudgetId(budget.id);
    setBudgetActionError(null);
    setEditBudgetForm({
      name: budget.name,
      period: budget.period,
      amount: budget.amount,
      categoryId: budget.categoryId ?? "",
      isActive: budget.isActive,
      effectiveStartDate: budget.effectiveStartDate,
      effectiveEndDate: budget.effectiveEndDate ?? "",
      includeExcludedTransactions: budget.includeExcludedTransactions
    });
  }

  function cancelEditBudget() {
    setEditingBudgetId(null);
    setBudgetActionError(null);
  }

  async function saveBudgetEdit(budgetId: string) {
    if (!isAuthenticated) {
      return;
    }

    const amount = Number(editBudgetForm.amount);
    if (!editBudgetForm.name.trim()) {
      setBudgetActionError("Budget name is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setBudgetActionError("Amount must be a non-negative number.");
      return;
    }
    if (!editBudgetForm.effectiveStartDate) {
      setBudgetActionError("Effective start date is required.");
      return;
    }
    if (
      editBudgetForm.effectiveEndDate &&
      editBudgetForm.effectiveEndDate < editBudgetForm.effectiveStartDate
    ) {
      setBudgetActionError(
        "Effective end date cannot be before effective start date."
      );
      return;
    }

    setBudgetActionLoading(true);
    setBudgetActionError(null);
    try {
      const response = await apiFetch(`/budgets/${budgetId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: editBudgetForm.name.trim(),
          period: editBudgetForm.period,
          amount,
          categoryId: editBudgetForm.categoryId || null,
          isActive: editBudgetForm.isActive,
          effectiveStartDate: editBudgetForm.effectiveStartDate,
          effectiveEndDate: editBudgetForm.effectiveEndDate || null,
          includeExcludedTransactions: editBudgetForm.includeExcludedTransactions
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `Failed to update budget (${response.status})`);
      }

      setEditingBudgetId(null);
      setRefreshNonce((current) => current + 1);
    } catch (updateError) {
      setBudgetActionError(
        updateError instanceof Error ? updateError.message : "Failed to update budget"
      );
    } finally {
      setBudgetActionLoading(false);
    }
  }

  async function deleteBudget(budgetId: string) {
    if (!isAuthenticated) {
      return;
    }

    setBudgetActionLoading(true);
    setBudgetActionError(null);
    try {
      const response = await apiFetch(`/budgets/${budgetId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `Failed to delete budget (${response.status})`);
      }

      if (editingBudgetId === budgetId) {
        setEditingBudgetId(null);
      }
      setRefreshNonce((current) => current + 1);
    } catch (deleteError) {
      setBudgetActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete budget"
      );
    } finally {
      setBudgetActionLoading(false);
    }
  }

  function onReportPresetChange(nextPreset: ReportDurationPreset) {
    setReportPreset(nextPreset);
    if (nextPreset !== "CUSTOM") {
      const range = rangeForPreset(nextPreset);
      setReportStartDate(range.startDate);
      setReportEndDate(range.endDate);
    }
  }

  async function runReport() {
    if (!isAuthenticated) {
      return;
    }
    if (!reportStartDate || !reportEndDate) {
      setReportError("Start and end dates are required.");
      return;
    }
    if (reportEndDate < reportStartDate) {
      setReportError("End date cannot be before start date.");
      return;
    }

    setReportLoading(true);
    setReportError(null);
    try {
      const response = await apiFetch("/reports/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dateFrom: reportStartDate,
          dateTo: reportEndDate,
          categoryIds: reportCategoryIds.length > 0 ? reportCategoryIds : undefined,
          includeExcluded: reportIncludeExcluded,
          groupBy: "none",
          limit: 2000
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `Failed to run report (${response.status})`);
      }

      const payload = (await response.json()) as ReportQueryResponse;
      setReportResult(payload);
    } catch (loadError) {
      setReportResult(null);
      setReportError(
        loadError instanceof Error ? loadError.message : "Failed to run report"
      );
    } finally {
      setReportLoading(false);
    }
  }

  async function submitAuth() {
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return;
    }
    if (authMode === "register" && !displayName.trim()) {
      setAuthError("Display name is required for registration.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setMfaChallengeToken(null);
    setMfaCode("");

    try {
      const response = await apiFetch(`/auth/${authMode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(authMode === "register"
            ? { displayName: displayName.trim() }
            : {})
        })
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: {
            fieldErrors?: Record<string, string[] | undefined>;
          };
        };
        const fieldErrors = Object.entries(
          errorPayload.details?.fieldErrors ?? {}
        )
          .filter(([, messages]) => Array.isArray(messages) && messages.length > 0)
          .map(([field, messages]) => `${field}: ${messages?.join(", ")}`)
          .join(" | ");
        throw new Error(
          fieldErrors
            ? `${errorPayload.error ?? "Authentication failed"} - ${fieldErrors}`
            : errorPayload.error ?? `Authentication failed (${response.status})`
        );
      }

      const payload = (await response.json()) as AuthResponse | MfaChallengeResponse;
      if ("mfaRequired" in payload && payload.mfaRequired) {
        setMfaChallengeToken(payload.challengeToken);
        setPassword("");
        setAuthError(null);
        return;
      }
      const authPayload = payload as AuthResponse;
      setCurrentUser({
        email: authPayload.user.email,
        displayName: authPayload.user.displayName
      });
      setCsrfToken(authPayload.csrfToken);
      setIsAuthenticated(true);
      setPassword("");
      setRefreshNonce((current) => current + 1);
    } catch (submitError) {
      setAuthError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to authenticate"
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function verifyMfaLogin() {
    if (!mfaChallengeToken) {
      setAuthError("No MFA challenge is active.");
      return;
    }
    if (!mfaCode.trim()) {
      setAuthError("Enter your MFA code.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await apiFetch("/auth/mfa/verify-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeToken: mfaChallengeToken,
          code: mfaCode.trim()
        })
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorPayload.error ?? `MFA verification failed (${response.status})`);
      }

      const payload = (await response.json()) as AuthResponse;
      setCurrentUser({
        email: payload.user.email,
        displayName: payload.user.displayName
      });
      setCsrfToken(payload.csrfToken);
      setIsAuthenticated(true);
      setMfaChallengeToken(null);
      setMfaCode("");
      setRefreshNonce((current) => current + 1);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to verify MFA");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    setIsAuthenticated(false);
    setCsrfToken("");
    setMfaChallengeToken(null);
    setMfaCode("");
    setCurrentUser(null);
    setPassword("");
    setPlaidMessage(null);
    setPlaidError(null);
    setResult(null);
    setPage(1);
  }

  const menuItems: MenuProps["items"] = [
    {
      key: "connect",
      label: plaidLoading ? "Connecting..." : "Connect Bank",
      disabled: plaidLoading
    },
    {
      key: "sync",
      label: syncLoading ? "Syncing..." : "Sync Now",
      disabled: syncLoading || plaidLoading
    },
    {
      type: "divider"
    },
    {
      key: "logout",
      label: "Log out"
    }
  ];

  function onMenuClick(key: string) {
    if (key === "connect") {
      void connectPlaid();
      return;
    }
    if (key === "sync") {
      void syncNow();
      return;
    }
    if (key === "logout") {
      void logout();
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <div className="topBar">
          <Typography.Title level={3} style={{ margin: 0 }}>
            Spending Tracker
          </Typography.Title>
          {isAuthenticated && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: menuItems,
                onClick: (info: { key: string }) => onMenuClick(info.key)
              }}
            >
              <Button title={currentUser?.email ?? "Menu"}>☰</Button>
            </Dropdown>
          )}
        </div>

        {!isAuthenticated && (
          <div className="authPanel">
            {!mfaChallengeToken && (
              <>
                <div className="authModeRow">
                  <Button
                    className={authMode === "login" ? "active" : ""}
                    onClick={() => setAuthMode("login")}
                  >
                    Sign In
                  </Button>
                  <Button
                    className={authMode === "register" ? "active" : ""}
                    onClick={() => setAuthMode("register")}
                  >
                    Register
                  </Button>
                </div>
                <div className="authFields">
                  <label>
                    Email
                    <Input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label>
                    Password
                    <Input.Password
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Your password"
                    />
                  </label>
                  {authMode === "register" && (
                    <label>
                      Display Name
                      <Input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="Your name"
                      />
                    </label>
                  )}
                  <Button
                    type="primary"
                    onClick={() => void submitAuth()}
                    disabled={authLoading}
                    loading={authLoading}
                  >
                    {authMode === "login" ? "Sign In" : "Create Account"}
                  </Button>
                </div>
              </>
            )}
            {mfaChallengeToken && (
              <div className="authFields">
                <label>
                  MFA Code
                  <Input
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    placeholder="6-digit authenticator code"
                  />
                </label>
                <Button
                  type="primary"
                  onClick={() => void verifyMfaLogin()}
                  disabled={authLoading}
                  loading={authLoading}
                >
                  Verify MFA
                </Button>
                <Button
                  onClick={() => {
                    setMfaChallengeToken(null);
                    setMfaCode("");
                  }}
                  disabled={authLoading}
                >
                  Back
                </Button>
              </div>
            )}
            {authError && <Alert type="error" showIcon message={authError} />}
          </div>
        )}

        {isAuthenticated && (
          <Tabs
            activeKey={activeTab}
            onChange={(key: string) =>
              setActiveTab(key as "transactions" | "budgets" | "rules" | "reports")
            }
            items={[
              { key: "transactions", label: "Transactions" },
              { key: "budgets", label: "Budgets" },
              { key: "rules", label: "Rules" },
              { key: "reports", label: "Reports" }
            ]}
          />
        )}

        {!isAuthenticated && (
          <p className="hint">Sign in or register above to load your transactions.</p>
        )}
        {error && <Alert type="error" showIcon message={error} />}
        {plaidMessage && <Alert type="info" showIcon message={plaidMessage} />}
        {plaidError && <Alert type="error" showIcon message={plaidError} />}

        {isAuthenticated && activeTab === "transactions" && (
          <>
            <div className="rowActions">
              <Button
                onClick={() => void syncNow()}
                loading={syncLoading}
                disabled={plaidLoading}
              >
                Sync now
              </Button>
              {lastSyncedAt && (
                <Typography.Text type="secondary">
                  Last synced: {new Date(lastSyncedAt).toLocaleString()}
                </Typography.Text>
              )}
            </div>
            {isMobile && (
              <Button
                className="mobileFilterBtn"
                onClick={() => setShowTransactionFilters((current) => !current)}
              >
                {showTransactionFilters ? "Hide Filters" : "Show Filters"}
              </Button>
            )}
            {(!isMobile || showTransactionFilters) && (
              <div className="controls">
                <label>
                  Search
                  <Input
                    placeholder="merchant or description"
                    value={search}
                    onChange={(event) => {
                      setPage(1);
                      setSearch(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Sort By
                  <Select
                    value={sortBy}
                    onChange={(value) => {
                      setPage(1);
                      setSortBy(value);
                    }}
                    options={[
                      { value: "transaction_date", label: "Transaction Date" },
                      { value: "amount", label: "Amount" },
                      { value: "created_at", label: "Created At" },
                      { value: "merchant_name", label: "Merchant Name" }
                    ]}
                  />
                </label>
                <label>
                  Sort Order
                  <Select
                    value={sortOrder}
                    onChange={(value) => {
                      setPage(1);
                      setSortOrder(value as "asc" | "desc");
                    }}
                    options={[
                      { value: "desc", label: "Descending" },
                      { value: "asc", label: "Ascending" }
                    ]}
                  />
                </label>
                <label>
                  Page Size
                  <Select
                    value={String(pageSize)}
                    onChange={(value) => {
                      setPage(1);
                      setPageSize(Number(value));
                    }}
                    options={[
                      { value: "10", label: "10" },
                      { value: "25", label: "25" },
                      { value: "50", label: "50" }
                    ]}
                  />
                </label>
                <label className="checkboxRow">
                  <Checkbox
                    checked={includeExcluded}
                    onChange={(event) => {
                      setPage(1);
                      setIncludeExcluded(event.target.checked);
                    }}
                  />
                  Include excluded
                </label>
              </div>
            )}
            {loading && <p className="hint">Loading transactions...</p>}
            {result && (
              <>
                <p className="hint">
                  Showing {result.data.length} of {result.meta.total} transactions.
                </p>
                {isMobile ? (
                  <div className="mobileList">
                    {result.data.map((tx) => (
                      <article key={tx.id} className="mobileItem">
                        <h4>{tx.merchantName ?? tx.description}</h4>
                        <p>{tx.transactionDate}</p>
                        <p>{tx.accountName}</p>
                        <p>{tx.categoryName ?? "Uncategorized"}</p>
                        <p>{formatMoney(tx.amount, tx.currencyCode)}</p>
                        <p>
                          {tx.pending ? "Pending" : "Posted"}
                          {tx.isExcluded ? " · Excluded" : ""}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Table
                    columns={transactionColumns}
                    dataSource={result.data}
                    rowKey="id"
                    pagination={false}
                    size="small"
                  />
                )}

                <div className="pager">
                  <Button
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={result.meta.page <= 1 || loading}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {result.meta.page} / {result.meta.totalPages}
                  </span>
                  <Button
                    onClick={() =>
                      setPage((current) => Math.min(result.meta.totalPages, current + 1))
                    }
                    disabled={result.meta.page >= result.meta.totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {isAuthenticated && activeTab === "budgets" && (
          <>
            <div className="budgetCreate">
              <label>
                Name
                <Input
                  placeholder="e.g. Groceries Weekly"
                  value={budgetForm.name}
                  onChange={(event) =>
                    setBudgetForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label>
                Period
                <Select
                  value={budgetForm.period}
                  options={[...BUDGET_PERIOD_OPTIONS]}
                  onChange={(value) =>
                    setBudgetForm((current) => ({
                      ...current,
                      period: value as "WEEKLY" | "MONTHLY"
                    }))
                  }
                />
              </label>
              <label>
                Amount
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={budgetForm.amount}
                  onChange={(event) =>
                    setBudgetForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </label>
              <label>
                Category (Optional)
                <Select
                  value={budgetForm.categoryId}
                  options={[
                    { value: "", label: "Overall" },
                    ...categories.map((category) => ({
                      value: category.id,
                      label: category.name
                    }))
                  ]}
                  onChange={(value) =>
                    setBudgetForm((current) => ({
                      ...current,
                      categoryId: value
                    }))
                  }
                />
              </label>
              <label>
                Start Date
                <Input
                  type="date"
                  value={budgetForm.effectiveStartDate}
                  onChange={(event) =>
                    setBudgetForm((current) => ({
                      ...current,
                      effectiveStartDate: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                End Date (Optional)
                <Input
                  type="date"
                  value={budgetForm.effectiveEndDate}
                  onChange={(event) =>
                    setBudgetForm((current) => ({
                      ...current,
                      effectiveEndDate: event.target.value
                    }))
                  }
                />
              </label>
              <label className="checkboxRow">
                <Checkbox
                  checked={budgetForm.includeExcludedTransactions}
                  onChange={(event) =>
                    setBudgetForm((current) => ({
                      ...current,
                      includeExcludedTransactions: event.target.checked
                    }))
                  }
                />
                Include excluded transactions
              </label>
              <Button
                type="primary"
                onClick={() => void createBudget()}
                disabled={budgetCreateLoading}
                loading={budgetCreateLoading}
              >
                Create Budget
              </Button>
            </div>
            {budgetCreateMessage && <Alert type="success" showIcon message={budgetCreateMessage} />}
            {budgetCreateError && <Alert type="error" showIcon message={budgetCreateError} />}
            {budgetActionError && <Alert type="error" showIcon message={budgetActionError} />}
            {budgetRecordsLoading && <p className="hint">Loading budgets...</p>}
            {budgetRecordsError && <Alert type="error" showIcon message={budgetRecordsError} />}
            {budgetRecords.length > 0 && (
              <Table
                columns={budgetColumns}
                dataSource={budgetRecords}
                rowKey="id"
                pagination={false}
                size="small"
              />
            )}
            {budgetsLoading && <p className="hint">Loading budget progress...</p>}
            {budgetsError && <Alert type="error" showIcon message={budgetsError} />}
            {budgets.length > 0 && (
              <div className="budgetGrid">
                {budgets.map((budget) => {
                  const progressPct = Math.min(
                    100,
                    Math.max(0, budget.progressRatio * 100)
                  );
                  const paceLabel =
                    budget.paceRatio > 1.05
                      ? "Over pace"
                      : budget.paceRatio < 0.95
                        ? "Under pace"
                        : "On pace";

                  return (
                    <article key={budget.budgetId} className="budgetCard">
                      <h3>{budget.budgetName}</h3>
                      <p className="hint">
                        {budget.period} · {budget.periodStartDate} to {budget.periodEndDate}
                      </p>
                      <p>
                        {formatMoney(budget.spent, "USD")} spent of{" "}
                        {formatMoney(budget.amount, "USD")}
                      </p>
                      <p>Remaining: {formatMoney(budget.remaining, "USD")}</p>
                      <p>Pace: {paceLabel}</p>
                      <div className="progressTrack">
                        <div className="progressFill" style={{ width: `${progressPct}%` }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {!budgetsLoading && budgets.length === 0 && (
              <p className="hint">No budgets are currently active for this date.</p>
            )}
          </>
        )}

        {isAuthenticated && activeTab === "rules" && (
          <>
            {rulesLoading && <p className="hint">Loading rules...</p>}
            {rulesError && <Alert type="error" showIcon message={rulesError} />}
            <div className="ruleCreate">
              <Select
                value={newRule.categoryId}
                options={[
                  { value: "", label: "Select Category" },
                  ...categories.map((category) => ({
                    value: category.id,
                    label: category.name
                  }))
                ]}
                onChange={(value) =>
                  setNewRule((current) => ({
                    ...current,
                    categoryId: value
                  }))
                }
              />
              <Select
                value={newRule.field}
                options={[...RULE_FIELD_OPTIONS]}
                onChange={(value) =>
                  setNewRule((current) => ({ ...current, field: value }))
                }
              />
              <Select
                value={newRule.operator}
                options={[...RULE_OPERATOR_OPTIONS]}
                onChange={(value) =>
                  setNewRule((current) => ({
                    ...current,
                    operator: value
                  }))
                }
              />
              <Input
                placeholder="pattern"
                value={newRule.pattern}
                onChange={(event) =>
                  setNewRule((current) => ({ ...current, pattern: event.target.value }))
                }
              />
              <Input
                type="number"
                min={1}
                max={10000}
                value={String(newRule.priority)}
                onChange={(event) =>
                  setNewRule((current) => ({
                    ...current,
                    priority: Number(event.target.value)
                  }))
                }
              />
              <Button type="primary" onClick={() => void createRule()}>
                Add Rule
              </Button>
            </div>
            <Table
              columns={ruleColumns}
              dataSource={rules}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </>
        )}

        {isAuthenticated && activeTab === "reports" && (
          <>
            {isMobile && (
              <Button
                className="mobileFilterBtn"
                onClick={() => setShowReportFilters((current) => !current)}
              >
                {showReportFilters ? "Hide Report Filters" : "Show Report Filters"}
              </Button>
            )}
            {(!isMobile || showReportFilters) && (
              <div className="reportControls">
                <label>
                  Duration
                  <Select
                    value={reportPreset}
                    onChange={(value) =>
                      onReportPresetChange(value as ReportDurationPreset)
                    }
                    options={[
                      { value: "LAST_7_DAYS", label: "Last 7 days" },
                      { value: "LAST_30_DAYS", label: "Last 30 days" },
                      { value: "THIS_MONTH", label: "This month" },
                      { value: "LAST_MONTH", label: "Last month" },
                      { value: "CUSTOM", label: "Custom range" }
                    ]}
                  />
                </label>
                <label>
                  Start Date
                  <Input
                    type="date"
                    value={reportStartDate}
                    onChange={(event) => {
                      setReportPreset("CUSTOM");
                      setReportStartDate(event.target.value);
                    }}
                  />
                </label>
                <label>
                  End Date
                  <Input
                    type="date"
                    value={reportEndDate}
                    onChange={(event) => {
                      setReportPreset("CUSTOM");
                      setReportEndDate(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Categories
                  <Select
                    value={reportCategoryIds}
                    mode="multiple"
                    onChange={(values) => setReportCategoryIds(values)}
                    options={categories.map((category) => ({
                      value: category.id,
                      label: category.name
                    }))}
                  />
                </label>
                <label className="checkboxRow">
                  <Checkbox
                    checked={reportIncludeExcluded}
                    onChange={(event) => setReportIncludeExcluded(event.target.checked)}
                  />
                  Include excluded
                </label>
                <Button
                  type="primary"
                  onClick={() => void runReport()}
                  disabled={reportLoading}
                  loading={reportLoading}
                >
                  {reportLoading ? "Running..." : "Run Report"}
                </Button>
              </div>
            )}

            {reportError && <Alert type="error" showIcon message={reportError} />}

            {reportResult && (
              <>
                <div className="reportSummary">
                  <Card size="small">
                    <Statistic
                      title="Total Spend"
                      value={Number(reportResult.totals.spent)}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                  <Card size="small">
                    <Statistic
                      title="Total Income"
                      value={Number(reportResult.totals.income)}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                  <Card size="small">
                    <Statistic
                      title="Net"
                      value={Number(reportResult.totals.net)}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                </div>

                {isMobile ? (
                  <div className="mobileList">
                    {reportResult.data.map((row) => (
                      <article key={row.id} className="mobileItem">
                        <h4>{row.merchant_name ?? row.original_description}</h4>
                        <p>{row.transaction_date}</p>
                        <p>{row.account_name}</p>
                        <p>{row.category_name ?? "Uncategorized"}</p>
                        <p>{formatMoney(row.amount, "USD")}</p>
                        <p>{row.is_excluded ? "Excluded" : "Included"}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Table
                    columns={reportColumns}
                    dataSource={reportResult.data}
                    rowKey="id"
                    pagination={false}
                    size="small"
                  />
                )}
                {reportResult.data.length === 0 && (
                  <p className="hint">No transactions matched this report filter.</p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
