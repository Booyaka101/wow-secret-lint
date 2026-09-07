local _, ns = ...

-- Late.lua has not run yet, so nothing is known about ns.late here.
if ns.late then ns.late:RegisterEvent("UNIT_AURA") end
