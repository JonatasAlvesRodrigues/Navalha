export function buildGranaFlowPayload({ monthRef, kpis, barbersRevenue, barbersRetention, stockItems }) {
  return {
    referenceMonth: monthRef,
    generatedAt: new Date().toISOString(),
    finance: {
      totalRevenue: Number(kpis.totalRevenue || 0),
      averageTicket: Number(kpis.averageTicket || 0),
      occupancyRate: Number(kpis.occupancyRate || 0),
    },
    performance: {
      revenueRanking: barbersRevenue.map((b, i) => ({
        rank: i + 1,
        barberId: b.barberId,
        barberName: b.barberName,
        totalRevenue: Number(b.totalRevenue || 0),
      })),
      retentionRanking: barbersRetention.map((b, i) => ({
        rank: i + 1,
        barberId: b.barberId,
        barberName: b.barberName,
        retentionRate: Number(b.retentionRate || 0),
      })),
    },
    inventory: stockItems.map((item) => ({
      productId: item.productId,
      name: item.name,
      currentQty: Number(item.currentQty || 0),
      minimumQty: Number(item.minimumQty || 0),
      status: Number(item.currentQty || 0) <= Number(item.minimumQty || 0) ? 'REPLENISH' : 'OK',
    })),
  };
}

export async function syncWithGranaFlow(payload, token) {
  const response = await fetch('/api/admin/granaflow/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to sync with GranaFlow');
  }

  return data;
}
