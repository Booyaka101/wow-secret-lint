-- Everything in this file appears on the "Tainted code is allowed to..." list at
-- https://warcraft.wiki.gg/wiki/Secret_Values and must never be reported.
local cache = {}

local function Store(value)
	-- allowed: pass secret values to Lua functions, store them as values in tables
	cache.latest = value
	return value
end

local function Render(unit)
	local hp = UnitHealth(unit)

	-- allowed: store in a variable and an upvalue
	local copy = hp
	cache.hp = copy

	-- allowed: pass a secret value to a Lua function
	Store(hp)

	-- allowed: concatenate secret values that are strings or numbers
	local label = "hp: " .. hp
	local both = hp .. "/" .. UnitHealthMax(unit)

	-- allowed: call string.concat, string.format and string.join with secret values
	local formatted = string.format("%s hp", hp)
	local joined = string.join(" ", "hp", hp)
	local concatenated = string.concat(label, both)

	-- allowed: boolean tests on non-boolean type secrets (UnitHealth returns a number)
	if hp then
		cache.seen = true
	end
	if not hp then
		cache.seen = false
	end

	-- allowed: store a secret as a table value in a constructor
	local payload = { value = hp, text = formatted }

	return label, both, formatted, joined, concatenated, payload
end

return Render
