-- Shape reconstructed from Breeni/BtWLoadouts#67 (AndyMM22, 2026-08-07, game 12.0.7):
--   "Unguarded cooldown compare on secret values in Talents, HeroTalents and Essences".
--   DFTalents.lua:237 already guards with `if canaccessvalue(start) and start ~= 0 then`;
--   five sibling sites do the same compare unguarded.
local Talents = {}

function Talents:IsSpellReady(spellID)
	local cooldown = C_Spell.GetSpellCooldown(spellID)
	-- isEnabled is marked NeverSecret in the generated docs, so this compare is fine.
	if not cooldown.isEnabled then
		return false
	end
	if cooldown.startTime ~= 0 then
		return false
	end
	return true
end

return Talents
