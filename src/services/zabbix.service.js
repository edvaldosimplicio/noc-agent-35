import logger from '../utils/logger.js';

export function parseZabbixAlert(body) {
  try {
    const {
      host,
      hostname,
      hostId,
      trigger,
      severity,
      status,
      message,
      eventId,
      itemName,
      itemValue,
    } = body;

    const severityMap = {
      '0': 'not_classified',
      '1': 'information',
      '2': 'warning',
      '3': 'average',
      '4': 'high',
      '5': 'disaster',
    };

    const priorityMap = {
      'not_classified': 'low',
      'information': 'low',
      'warning': 'medium',
      'average': 'medium',
      'high': 'high',
      'disaster': 'critical',
    };

    const sev = severityMap[severity] || severity || 'average';

    return {
      host: host || hostname || 'Unknown',
      hostId: hostId || null,
      trigger: trigger || message || 'Unknown trigger',
      severity: sev,
      priority: priorityMap[sev] || 'medium',
      status: status || 'PROBLEM',
      eventId: eventId || null,
      itemName: itemName || null,
      itemValue: itemValue || null,
      raw: body,
    };
  } catch (err) {
    logger.error(`Error parsing Zabbix alert: ${err.message}`);
    return null;
  }
}

export function formatAlertMessage(alert) {
  const emoji = {
    low: 'ℹ️',
    medium: '⚠️',
    high: '🔴',
    critical: '🚨',
  };

  return [
    `${emoji[alert.priority] || '⚠️'} **ALERTA ZABBIX**`,
    `📍 Host: ${alert.host}`,
    `🔔 Trigger: ${alert.trigger}`,
    `📊 Severidade: ${alert.severity}`,
    alert.itemName ? `📈 Item: ${alert.itemName} = ${alert.itemValue}` : '',
    `⏰ Status: ${alert.status}`,
  ].filter(Boolean).join('\n');
}
