'use strict';

function clamp(minimum, maximum, value) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreContribution(input = {}) {
  const confirmations = Math.max(0, Number(input.confirmations) || 0);
  const rejections = Math.max(0, Number(input.rejections) || 0);
  const ageDays = Math.max(0, Number(input.ageDays) || 0);
  const total = confirmations + rejections;
  const evidence = Math.min(1, total / 5);
  const consensus = total ? (confirmations - rejections) / total : 0;
  const freshness = clamp(0.65, 1, 1 - ageDays / 365);
  const score = clamp(0, 100, Math.round((50 + 50 * consensus * evidence) * freshness));
  const label = total < 2 ? 'evidencia limitada' : score >= 70 ? 'confianza alta' : score >= 45 ? 'confianza media' : 'confianza baja';
  return { score, label, evidenceCount: total, confirmations, rejections };
}

function scoreContributionRow(row) {
  const createdAt = row.created_at || row.createdAt;
  const ageDays = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 86_400_000 : 0;
  return scoreContribution({ confirmations: row.confirmations, rejections: row.rejections, ageDays });
}

function decorateContribution(row) {
  const createdAt = row.created_at || row.createdAt;
  const confidence = scoreContributionRow(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    status: row.status,
    zone: row.zone_name || row.zone,
    geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry,
    authorAlias: row.public_alias || row.authorAlias,
    confirmations: Number(row.confirmations) || 0,
    rejections: Number(row.rejections) || 0,
    confidence,
    version: Number(row.version),
    own: row.own === true,
    myReaction: row.my_reaction || row.myReaction || null,
    createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    conditionType: row.condition_type || row.conditionType || 'other',
    affectedGroups: row.affected_groups || row.affectedGroups || [],
    observedOn: row.observed_on || row.observedOn || null,
    permanence: row.permanence || 'unknown',
    measurementStatus: row.measurement_status || row.measurementStatus || 'unmeasured',
    clearWidthCm: row.clear_width_cm ?? row.clearWidthCm ?? null,
    lifecycle: row.lifecycle_status || row.lifecycle || 'open',
    resolvedAt: row.resolved_at || row.resolvedAt || null
  };
}

module.exports = { clamp, decorateContribution, scoreContribution, scoreContributionRow };
