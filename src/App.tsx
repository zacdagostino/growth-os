import {
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  growthOSProducts,
  initialConnections,
  initialMappings,
  metaAdImports,
  metaCampaignImports,
  metaImportFields,
  shopifyImportFields,
  shopifyProductImports,
} from "./mockData";
import type {
  IntegrationConnection,
  IntegrationProvider,
  ProductAdMapping,
} from "./types";

const routes = [
  { href: "/", label: "Dashboard" },
  { href: "/settings/app-setup", label: "App Setup" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/imports/shopify", label: "Shopify Imports" },
  { href: "/imports/meta-ads", label: "Meta Ads Imports" },
  { href: "/mappings", label: "Mappings" },
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function nowLabel() {
  return new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStatus(status: IntegrationConnection["status"]) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Not Connected";
}

type ShopifyAppSettings = {
  configured: boolean;
  apiKeyMasked: string;
  apiSecretMasked: string;
  scopes: string;
  redirectUri: string;
};

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [connections, setConnections] =
    useState<IntegrationConnection[]>(initialConnections);
  const [mappings, setMappings] =
    useState<ProductAdMapping[]>(initialMappings);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [shopifyNotice, setShopifyNotice] = useState("");
  const [shopifyAppSettings, setShopifyAppSettings] =
    useState<ShopifyAppSettings | null>(null);

  function navigate(href: string) {
    window.history.pushState(null, "", href);
    setPath(href);
    setIsNavOpen(false);
  }

  window.onpopstate = () => setPath(window.location.pathname);

  function updateConnection(provider: IntegrationProvider, next: IntegrationConnection) {
    setConnections((current) =>
      current.map((connection) =>
        connection.provider === provider ? next : connection,
      ),
    );
  }

  const shopifyConnection = connections.find(
    (connection) => connection.provider === "shopify",
  )!;
  const metaConnection = connections.find(
    (connection) => connection.provider === "meta-ads",
  )!;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop") || "";
    const status = params.get("shopify");

    async function loadShopifyConnection() {
      try {
        const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";
        const response = await fetch(`/api/integrations/shopify/status${query}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          status: IntegrationConnection["status"];
          accountName?: string;
          storeDomain?: string;
          lastSyncAt?: string;
        };

        updateConnection("shopify", {
          id: "shopify",
          provider: "shopify",
          status: data.status,
          accountName: data.accountName,
          storeDomain: data.storeDomain,
          lastSyncAt: data.lastSyncAt
            ? new Date(data.lastSyncAt).toLocaleString()
            : undefined,
        });
      } catch {
        updateConnection("shopify", {
          id: "shopify",
          provider: "shopify",
          status: "error",
          errorMessage: "Could not load Shopify connection status.",
        });
      }
    }

    async function loadShopifyAppSettings() {
      try {
        const response = await fetch("/api/settings/shopify-app");
        if (!response.ok) return;
        const data = (await response.json()) as ShopifyAppSettings;
        setShopifyAppSettings(data);
      } catch {
        setShopifyAppSettings(null);
      }
    }

    if (status === "connected") {
      setShopifyNotice("Shopify connected successfully.");
      window.history.replaceState(null, "", "/settings/integrations");
      setPath("/settings/integrations");
    }

    void loadShopifyConnection();
    void loadShopifyAppSettings();
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <div>
            <strong>GrowthOS</strong>
            <span>Insidecats</span>
          </div>
        </div>
        <button
          className="menu-toggle"
          aria-expanded={isNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setIsNavOpen((open) => !open)}
        >
          Menu
        </button>
        <nav
          id="primary-navigation"
          className={isNavOpen ? "nav-open" : ""}
        >
          {routes.map((route) => (
            <button
              className={path === route.href ? "active" : ""}
              key={route.href}
              onClick={() => navigate(route.href)}
            >
              {route.label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        {path === "/" ? (
          <DashboardPage
            shopifyConnection={shopifyConnection}
            metaConnection={metaConnection}
            navigate={navigate}
          />
        ) : null}
        {path === "/settings/integrations" ? (
          <IntegrationsPage
            shopifyConnection={shopifyConnection}
            metaConnection={metaConnection}
            updateConnection={updateConnection}
            navigate={navigate}
            shopifyNotice={shopifyNotice}
            setShopifyNotice={setShopifyNotice}
            shopifyAppConfigured={Boolean(shopifyAppSettings?.configured)}
          />
        ) : null}
        {path === "/settings/app-setup" ? (
          <ShopifyAppSetupPage
            initialSettings={shopifyAppSettings}
            setShopifyAppSettings={setShopifyAppSettings}
          />
        ) : null}
        {path === "/imports/shopify" ? <ShopifyImportsPage /> : null}
        {path === "/imports/meta-ads" ? <MetaAdsImportsPage /> : null}
        {path === "/mappings" ? (
          <MappingsPage mappings={mappings} setMappings={setMappings} />
        ) : null}
      </main>
    </div>
  );
}

type DashboardPageProps = {
  shopifyConnection: IntegrationConnection;
  metaConnection: IntegrationConnection;
  navigate: (href: string) => void;
};

function DashboardPage({
  shopifyConnection,
  metaConnection,
  navigate,
}: DashboardPageProps) {
  const shopifyTotals = shopifyProductImports.reduce(
    (sum, product) => ({
      revenue: sum.revenue + product.revenue,
      netSales: sum.netSales + product.netSales,
      orders: sum.orders + product.orders,
      refunds: sum.refunds + product.refunds,
    }),
    { revenue: 0, netSales: 0, orders: 0, refunds: 0 },
  );
  const metaTotals = metaAdImports.reduce(
    (sum, ad) => ({
      spend: sum.spend + ad.spend,
      purchases: sum.purchases + ad.purchases,
      clicks: sum.clicks + ad.clicks,
      impressions: sum.impressions + ad.impressions,
    }),
    { spend: 0, purchases: 0, clicks: 0, impressions: 0 },
  );
  const blendedRoas = shopifyTotals.revenue / metaTotals.spend;
  const connectedCount = [shopifyConnection, metaConnection].filter(
    (connection) => connection.status === "connected",
  ).length;

  return (
    <section className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">Home</p>
          <h1>Insidecats growth dashboard</h1>
          <p>
            A mock operating view for product revenue, ad spend, and mapping
            readiness before the live Shopify and Meta integrations are wired in.
          </p>
        </div>
        <button onClick={() => navigate("/settings/integrations")}>
          Manage Integrations
        </button>
      </header>

      <div className="metric-grid">
        <MetricCard label="Revenue" value={currency.format(shopifyTotals.revenue)} />
        <MetricCard label="Net sales" value={currency.format(shopifyTotals.netSales)} />
        <MetricCard label="Ad spend" value={currency.format(metaTotals.spend)} />
        <MetricCard label="Blended ROAS" value={`${blendedRoas.toFixed(1)}x`} />
      </div>

      <div className="dashboard-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Integration readiness</h2>
            <span className="status connected">{connectedCount}/2 connected</span>
          </div>
          <div className="readiness-list">
            <ReadinessRow title="Shopify" connection={shopifyConnection} />
            <ReadinessRow title="Meta/Facebook Ads" connection={metaConnection} />
          </div>
        </article>

        <article className="card">
          <h2>Today at a glance</h2>
          <div className="summary-list">
            <div>
              <strong>{shopifyTotals.orders}</strong>
              <span>mock Shopify orders</span>
            </div>
            <div>
              <strong>{metaTotals.purchases}</strong>
              <span>mock attributed purchases</span>
            </div>
            <div>
              <strong>{metaTotals.clicks.toLocaleString()}</strong>
              <span>mock Meta clicks</span>
            </div>
            <div>
              <strong>{currency.format(shopifyTotals.refunds)}</strong>
              <span>mock refunds</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReadinessRow({
  title,
  connection,
}: {
  title: string;
  connection: IntegrationConnection;
}) {
  return (
    <div className="readiness-row">
      <div>
        <strong>{title}</strong>
        <span>{connection.accountName ?? "Connect from Settings"}</span>
      </div>
      <span className={`status ${connection.status}`}>
        {formatStatus(connection.status)}
      </span>
    </div>
  );
}

function ShopifyAppSetupPage({
  initialSettings,
  setShopifyAppSettings,
}: {
  initialSettings: ShopifyAppSettings | null;
  setShopifyAppSettings: Dispatch<SetStateAction<ShopifyAppSettings | null>>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [scopes, setScopes] = useState(
    initialSettings?.scopes || "read_products,read_orders,read_customers",
  );
  const [redirectUri, setRedirectUri] = useState(
    initialSettings?.redirectUri || "http://localhost:8787/api/shopify/callback",
  );
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!initialSettings) return;
    setScopes(initialSettings.scopes);
    setRedirectUri(initialSettings.redirectUri);
  }, [initialSettings]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/settings/shopify-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          apiSecret,
          scopes,
          redirectUri,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setNotice(data.error || "Could not save Shopify app settings.");
        return;
      }

      const statusResponse = await fetch("/api/settings/shopify-app");
      if (!statusResponse.ok) return;
      const data = (await statusResponse.json()) as ShopifyAppSettings;
      setShopifyAppSettings(data);
      setApiKey("");
      setApiSecret("");
      setNotice("Shopify app credentials saved.");
    } catch {
      setNotice("Could not save Shopify app settings.");
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>App setup</h1>
        <p>
          Configure Shopify app credentials in-app. Credentials are stored on the
          server and never exposed in browser state after save.
        </p>
      </header>

      {notice ? <p className="notice">{notice}</p> : null}

      <article className="card setup-card">
        <div className="card-title-row">
          <h2>Shopify app credentials</h2>
          <span
            className={`status ${initialSettings?.configured ? "connected" : "not_connected"}`}
          >
            {initialSettings?.configured ? "Configured" : "Not Configured"}
          </span>
        </div>

        <p className="muted">
          Current key: {initialSettings?.apiKeyMasked || "Not set"} | Current secret:{" "}
          {initialSettings?.apiSecretMasked || "Not set"}
        </p>

        <form className="setup-form" onSubmit={saveSettings}>
          <label htmlFor="shopify-api-key">Shopify API key</label>
          <input
            id="shopify-api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Enter Shopify API key"
          />

          <label htmlFor="shopify-api-secret">Shopify API secret</label>
          <input
            id="shopify-api-secret"
            type="password"
            value={apiSecret}
            onChange={(event) => setApiSecret(event.target.value)}
            placeholder="Enter Shopify API secret"
          />

          <label htmlFor="shopify-scopes">Scopes</label>
          <input
            id="shopify-scopes"
            value={scopes}
            onChange={(event) => setScopes(event.target.value)}
          />

          <label htmlFor="shopify-redirect-uri">Redirect URI</label>
          <input
            id="shopify-redirect-uri"
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
          />

          <button type="submit">Save Shopify App Settings</button>
        </form>
      </article>
    </section>
  );
}

type IntegrationsProps = {
  shopifyConnection: IntegrationConnection;
  metaConnection: IntegrationConnection;
  updateConnection: (
    provider: IntegrationProvider,
    next: IntegrationConnection,
  ) => void;
  navigate: (href: string) => void;
  shopifyNotice: string;
  setShopifyNotice: Dispatch<SetStateAction<string>>;
  shopifyAppConfigured: boolean;
};

function IntegrationsPage({
  shopifyConnection,
  metaConnection,
  updateConnection,
  navigate,
  shopifyNotice,
  setShopifyNotice,
  shopifyAppConfigured,
}: IntegrationsProps) {
  const [shopDomain, setShopDomain] = useState("insidecats.myshopify.com");

  function connectShopify(event: FormEvent) {
    event.preventDefault();
    const normalized = shopDomain.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
      setShopifyNotice("Enter a valid .myshopify.com domain.");
      return;
    }
    if (!shopifyAppConfigured) {
      setShopifyNotice("Configure Shopify app credentials first in Settings > App Setup.");
      return;
    }

    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(normalized)}`;
  }

  function connectMeta() {
    // Future Meta implementation: replace this mock picker with Meta OAuth and
    // Ads Insights API access. Tokens must be stored securely server-side or in
    // a database, never exposed in the browser.
    updateConnection("meta-ads", {
      id: "meta-ads",
      provider: "meta-ads",
      status: "connected",
      accountName: "Insidecats Ads Account",
      accountId: "act_238612890000",
      lastSyncAt: nowLabel(),
    });
  }

  async function disconnect(provider: IntegrationProvider) {
    if (provider === "shopify") {
      try {
        const response = await fetch("/api/integrations/shopify/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop: shopifyConnection.storeDomain }),
        });
        if (!response.ok) {
          setShopifyNotice("Shopify disconnect failed. Try again.");
          return;
        }
      } catch {
        setShopifyNotice("Shopify disconnect failed. Try again.");
        return;
      }
    }

    updateConnection(provider, {
      id: provider,
      provider,
      status: "not_connected",
    });
    if (provider === "shopify") setShopifyNotice("Shopify disconnected.");
  }

  function syncNow(connection: IntegrationConnection) {
    updateConnection(connection.provider, {
      ...connection,
      lastSyncAt: nowLabel(),
      status: "connected",
    });
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Integrations</h1>
        <p>
          Connect revenue and ad platforms through the app UI. These flows are
          mocked now and shaped for OAuth later.
        </p>
      </header>
      {shopifyNotice ? <p className="notice">{shopifyNotice}</p> : null}

      <div className="integration-grid">
        <IntegrationCard
          title="Shopify"
          connection={shopifyConnection}
          onDisconnect={() => disconnect("shopify")}
          onSync={() => syncNow(shopifyConnection)}
          importPath="/imports/shopify"
          navigate={navigate}
        >
          <form className="connect-form" onSubmit={connectShopify}>
            <label htmlFor="shopify-domain">myshopify store domain</label>
            <div className="inline-form">
              <input
                id="shopify-domain"
                value={shopDomain}
                onChange={(event) => setShopDomain(event.target.value)}
                placeholder="insidecats.myshopify.com"
              />
              <button type="submit">Connect Shopify</button>
            </div>
          </form>
          <ImportList title="Will import" items={shopifyImportFields} />
        </IntegrationCard>

        <IntegrationCard
          title="Meta/Facebook Ads"
          connection={metaConnection}
          onConnect={connectMeta}
          onDisconnect={() => disconnect("meta-ads")}
          onSync={() => syncNow(metaConnection)}
          importPath="/imports/meta-ads"
          navigate={navigate}
        >
          {metaConnection.status === "connected" ? (
            <div className="account-callout">
              <strong>{metaConnection.accountName}</strong>
              <span>{metaConnection.accountId}</span>
            </div>
          ) : (
            <p className="muted">
              Mock flow will simulate selecting an ad account.
            </p>
          )}
          <ImportList title="Will import" items={metaImportFields} />
        </IntegrationCard>
      </div>
    </section>
  );
}

type IntegrationCardProps = {
  title: string;
  connection: IntegrationConnection;
  children: ReactNode;
  onConnect?: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  importPath: string;
  navigate: (href: string) => void;
};

function IntegrationCard({
  title,
  connection,
  children,
  onConnect,
  onDisconnect,
  onSync,
  importPath,
  navigate,
}: IntegrationCardProps) {
  const isConnected = connection.status === "connected";

  return (
    <article className="card integration-card">
      <div className="card-title-row">
        <h2>{title}</h2>
        <span className={`status ${connection.status}`}>
          {formatStatus(connection.status)}
        </span>
      </div>
      <dl className="connection-meta">
        <div>
          <dt>Account/store</dt>
          <dd>{connection.accountName ?? "None connected"}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{connection.lastSyncAt ?? "Never"}</dd>
        </div>
      </dl>
      {children}
      <div className="button-row">
        {onConnect ? (
          <button onClick={onConnect} disabled={isConnected}>
            Connect
          </button>
        ) : null}
        <button onClick={onDisconnect} disabled={!isConnected}>
          Disconnect
        </button>
        <button onClick={onSync} disabled={!isConnected}>
          Sync Now
        </button>
        <button className="secondary" onClick={() => navigate(importPath)}>
          View Imports
        </button>
      </div>
    </article>
  );
}

function ImportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="pill-list">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function ShopifyImportsPage() {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Imports</p>
        <h1>Shopify</h1>
        <p>Mock imported product and revenue rows from the future Shopify sync.</p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product title</th>
              <th>Shopify product ID</th>
              <th>Price</th>
              <th>Orders</th>
              <th>Revenue</th>
              <th>Refunds</th>
              <th>Gross sales</th>
              <th>Net sales</th>
            </tr>
          </thead>
          <tbody>
            {shopifyProductImports.map((product) => (
              <tr key={product.shopifyProductId}>
                <td>{product.productTitle}</td>
                <td>{product.shopifyProductId}</td>
                <td>{currency.format(product.price)}</td>
                <td>{product.orders}</td>
                <td>{currency.format(product.revenue)}</td>
                <td>{currency.format(product.refunds)}</td>
                <td>{currency.format(product.grossSales)}</td>
                <td>{currency.format(product.netSales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetaAdsImportsPage() {
  const totals = useMemo(
    () =>
      metaCampaignImports.reduce(
        (sum, campaign) => ({
          spend: sum.spend + campaign.spend,
          purchases: sum.purchases + campaign.purchases,
          impressions: sum.impressions + campaign.impressions,
        }),
        { spend: 0, purchases: 0, impressions: 0 },
      ),
    [],
  );

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Imports</p>
        <h1>Meta Ads</h1>
        <p>
          Mock imported ad performance rows. Campaign summary:{" "}
          {currency.format(totals.spend)} spend, {totals.purchases} purchases,{" "}
          {totals.impressions.toLocaleString()} impressions.
        </p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign name</th>
              <th>Ad set name</th>
              <th>Ad name</th>
              <th>Meta ad ID</th>
              <th>Spend</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>Purchases</th>
              <th>CPA</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {metaAdImports.map((ad) => (
              <tr key={ad.metaAdId}>
                <td>{ad.campaignName}</td>
                <td>{ad.adSetName}</td>
                <td>{ad.adName}</td>
                <td>{ad.metaAdId}</td>
                <td>{currency.format(ad.spend)}</td>
                <td>{ad.impressions.toLocaleString()}</td>
                <td>{ad.clicks.toLocaleString()}</td>
                <td>{ad.ctr}%</td>
                <td>{ad.purchases}</td>
                <td>{currency.format(ad.cpa)}</td>
                <td>{ad.roas.toFixed(1)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type MappingsPageProps = {
  mappings: ProductAdMapping[];
  setMappings: Dispatch<SetStateAction<ProductAdMapping[]>>;
};

function MappingsPage({ mappings, setMappings }: MappingsPageProps) {
  function assign(metaAdId: string, product?: string) {
    setMappings((current) =>
      current.map((mapping) =>
        mapping.metaAdId === metaAdId
          ? {
              ...mapping,
              assignedGrowthOSProduct: product,
              confidence: product ? "Manual" : mapping.detectedProduct === "Ambiguous" ? "Low" : mapping.confidence,
            }
          : mapping,
      ),
    );
  }

  function quickActionProduct(mapping: ProductAdMapping) {
    if (mapping.assignedGrowthOSProduct || mapping.detectedProduct === "Ambiguous") {
      return undefined;
    }

    return mapping.detectedProduct;
  }

  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Attribution</p>
        <h1>Product/ad mappings</h1>
        <p>
          Assign imported Meta ads to GrowthOS products so ad spend can roll up
          against product-level revenue and margin.
        </p>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Meta ad name</th>
              <th>Meta campaign</th>
              <th>Detected product</th>
              <th>Assigned GrowthOS product</th>
              <th>Confidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.metaAdId}>
                <td>{mapping.metaAdName}</td>
                <td>{mapping.metaCampaign}</td>
                <td>{mapping.detectedProduct ?? "None"}</td>
                <td>
                  <select
                    value={mapping.assignedGrowthOSProduct ?? ""}
                    onChange={(event) =>
                      assign(mapping.metaAdId, event.target.value || undefined)
                    }
                    aria-label={`Assign ${mapping.metaAdName}`}
                  >
                    <option value="">Unassigned</option>
                    {growthOSProducts.map((product) => (
                      <option key={product} value={product}>
                        {product}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`confidence ${mapping.confidence.toLowerCase()}`}>
                    {mapping.confidence}
                  </span>
                </td>
                <td className="action-cell">
                  <button
                    onClick={() =>
                      assign(mapping.metaAdId, quickActionProduct(mapping))
                    }
                  >
                    {mapping.assignedGrowthOSProduct ? "Change" : "Assign"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => assign(mapping.metaAdId, undefined)}
                    disabled={!mapping.assignedGrowthOSProduct}
                  >
                    Unassign
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
