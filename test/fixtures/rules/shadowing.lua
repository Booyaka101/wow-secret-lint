-- A shadowed local must not inherit the outer taint.
local function Outer(unit)
	local value = UnitHealth(unit)
	do
		local value = 10
		local safe = value * 2      -- inner `value` is a plain number, no finding
		return safe
	end
end

-- Reassignment from a non-secret source clears the taint.
local function Reassigned(unit)
	local v = UnitHealth(unit)
	v = 5
	return v + 1                     -- no finding
end

-- scrubsecretvalues launders the value.
local function Scrubbed(unit)
	local v = scrubsecretvalues(UnitHealth(unit))
	return v + 1                     -- no finding
end

-- secretwrap is also a boundary.
local function Wrapped(unit)
	local v = secretwrap(UnitHealth(unit))
	return v * 2                     -- no finding
end

return Outer, Reassigned, Scrubbed, Wrapped
