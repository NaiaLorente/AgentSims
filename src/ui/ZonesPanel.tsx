import { useSimStore } from '../state/simStore';
import type { ZoneKind } from '../sim/types';

const ZONE_ICON: Record<ZoneKind, string> = {
  house: '🏠',
  shop: '🛒',
  restaurant: '🍽️',
  park: '🌳',
};

/**
 * Who's claimed what, where — the only place "politics" (self-declared roles
 * and jobs) is visible as a whole, instead of scattered across each agent's
 * own memory. The engine never resolves conflicts here: if two agents both
 * claim to lead the same place, both simply show up.
 */
export function ZonesPanel() {
  const zones = useSimStore((s) => s.zones);
  const agents = useSimStore((s) => s.agents);
  const agentOrder = useSimStore((s) => s.agentOrder);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
        Zones <span className="normal-case text-white/30">— places, who owns them, who's claimed a role there</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {zones.map((zone) => {
          const holders = agentOrder
            .map((id) => agents[id])
            .filter((a): a is NonNullable<typeof a> => !!a)
            .flatMap((a) => a.roles.filter((r) => r.zoneId === zone.id).map((r) => ({ agent: a, role: r })));

          return (
            <li key={zone.id} className="rounded-md bg-black/20 p-2 text-xs">
              <div className="flex items-center gap-1.5 text-white/80">
                <span aria-hidden>{ZONE_ICON[zone.kind]}</span>
                <span className="font-medium">{zone.name}</span>
              </div>
              {zone.kind === 'house' && (
                <p className="mt-1 text-white/60">
                  {zone.ownerId ? (
                    <>
                      Owned by <span className="text-white/80">{zone.ownerLabel}</span>
                    </>
                  ) : (
                    <span className="text-white/30">Unowned — can be bought</span>
                  )}
                </p>
              )}
              {holders.length === 0 ? (
                <p className="mt-1 text-white/30">No role claimed here.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5 pl-5">
                  {holders.map(({ agent, role }, i) => (
                    <li key={i} className="text-white/60">
                      <span className="text-white/40">{agent.label}:</span> "{role.title}"
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
