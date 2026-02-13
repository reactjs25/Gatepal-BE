const { countryCityData } = require('../utils/countryCityData');
const Society = require('../model/societySchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { sendSystemAlertEmail } = require('../utils/systemAlertEmail');
const { normalizeString } = require('../utils/strings');
const MissingUnitRequest = require('../model/missingUnitRequestSchema');

const getCountryCityOptions = async (req, res) => {
    const options = countryCityData.map((c) => {
        const states = Array.isArray(c.states) ? c.states : [];
        const cities = Array.from(
            new Set(
                states.flatMap((st) => (Array.isArray(st.cities) ? st.cities : []))
            )
        ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return {
            countryCode: c.countryCode || '',
            countryName: c.countryName || '',
            cities,
        };
    });
    return sendSuccessResponse(res, 200, 'Country and city options fetched successfully.', {
        data: options,
    });
};



const mapUnits = (units = []) =>
    units
        .filter((unit) => unit?.unitNumber)
        .map((unit) => ({
            id: unit._id,
            unitNumber: unit.unitNumber.trim(),
        }));

const mapWings = (structure = []) =>
    structure
        .filter((wing) => wing?.wingName)
        .map((wing) => ({
            id: wing._id,
            name: wing.wingName.trim(),
            totalUnits: wing.totalUnits || wing.units?.length || 0,
            units: mapUnits(wing.units),
        }));

const mapSociety = (society) => ({
    id: society._id,
    name: society.societyName,
    societyName: society.societyName,
    societyPin: society.societyPin,
    wings: mapWings(society.structure),
});

const sortByName = (collection = []) =>
    collection.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

const getRegistrationHierarchy = async (req, res, next) => {
    try {
        const { societyId } = req.query || {};
        let societies = [];

        if (societyId) {
            const society = await Society.findById(
                societyId,
                'societyName societyPin country city structure status'
            ).lean();

            if (!society) {
                throw createHttpError('Society not found.', 404);
            }

            societies = [society];
        } else {
            societies = await Society.find({}, 'societyName societyPin country city structure status').lean();
        }

        const countryMap = new Map();

        societies.forEach((society) => {
            const countryName = (society.country || 'Unknown').trim();
            const cityName = (society.city || 'Unknown').trim();

            if (!countryMap.has(countryName)) {
                countryMap.set(countryName, new Map());
            }

            const cityMap = countryMap.get(countryName);

            if (!cityMap.has(cityName)) {
                cityMap.set(cityName, []);
            }

            cityMap.get(cityName).push(mapSociety(society));
        });

        const countries = sortByName(
            Array.from(countryMap.entries()).map(([countryName, cityMap]) => ({
                name: countryName,
                cities: sortByName(
                    Array.from(cityMap.entries()).map(([cityName, societiesInCity]) => ({
                        name: cityName,
                        societies: societiesInCity.sort((a, b) =>
                            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                        ),
                    }))
                ),
            }))
        );

        return sendSuccessResponse(res, 200, 'Registration hierarchy fetched successfully.', {
            data: {
                countries,
                totals: {
                    countries: countries.length,
                    cities: countries.reduce((sum, country) => sum + country.cities.length, 0),
                    societies: societies.length,
                },
            },
        });
    } catch (error) {
        if (error?.name === 'CastError' && error?.path === '_id') {
            return next(createHttpError('Society not found.', 404));
        }
        next(setErrorDefaults(error, 'Failed to fetch registration hierarchy'));
    }
};

const VALID_LOCATION_TYPES = new Set(['country', 'city', 'society', 'unit']);

const notifyMissingLocation = async (req, res, next) => {
    try {
        const authUser = req.appUser || null;
        const {
            type,
            name,
            country,
            city,
            societyName,
            wingName,
            societyPin,
            notes,
            searchQuery,
        } = req.body || {};

        const normalizedType = normalizeString(type || '').toLowerCase();

        if (!VALID_LOCATION_TYPES.has(normalizedType)) {
            throw createHttpError('Invalid location type. Expected country, city, or society.', 400);
        }

        const normalizedName = normalizeString(name || searchQuery);

        if (!normalizedName) {
            throw createHttpError('Name is required for the missing location.', 400);
        }

        const normalizedCountry = normalizeString(country);
        const normalizedCity = normalizeString(city);
        const normalizedSocietyName = normalizeString(societyName);
        const normalizedWingName = normalizeString(wingName);
        const normalizedSocietyPin = normalizeString(societyPin);
        const normalizedNotes = normalizeString(notes);

        const subject = `Onboarding: missing ${normalizedType} "${normalizedName}"`;

        const lines = [];

        lines.push(`A user reported a missing ${normalizedType} during onboarding.`);
        lines.push('');
        lines.push(`Reported type: ${normalizedType}`);
        lines.push(`Entered name: ${normalizedName}`);

        if (normalizedCountry) {
            lines.push(`Country context: ${normalizedCountry}`);
        }

        if (normalizedCity) {
            lines.push(`City context: ${normalizedCity}`);
        }

        if (normalizedSocietyName) {
            lines.push(`Society name: ${normalizedSocietyName}`);
        }

        if (normalizedWingName) {
            lines.push(`Wing name: ${normalizedWingName}`);
        }

        if (normalizedSocietyPin) {
            lines.push(`Society PIN: ${normalizedSocietyPin}`);
        }

        if (normalizedNotes) {
            lines.push(`Additional notes: ${normalizedNotes}`);
        }

        if (authUser) {
            const userName = authUser.fullName || authUser.name || '';
            lines.push('');
            lines.push('User details:');
            lines.push(`User ID: ${String(authUser._id)}`);
            if (userName) {
                lines.push(`User name: ${userName}`);
            }
            lines.push(`Role: ${authUser.role}`);
            lines.push(
                `Phone: ${(authUser.countryCode || '').toString()} ${(authUser.phoneNumber || '').toString()}`
            );
        }

        const text = lines.join('\n');

        const htmlSections = [];

        htmlSections.push(`<p>A user reported a missing ${normalizedType} during onboarding.</p>`);
        htmlSections.push('<ul>');
        htmlSections.push(`<li><strong>Reported type:</strong> ${normalizedType}</li>`);
        htmlSections.push(`<li><strong>Entered name:</strong> ${normalizedName}</li>`);

        if (normalizedCountry) {
            htmlSections.push(`<li><strong>Country context:</strong> ${normalizedCountry}</li>`);
        }

        if (normalizedCity) {
            htmlSections.push(`<li><strong>City context:</strong> ${normalizedCity}</li>`);
        }

        if (normalizedSocietyName) {
            htmlSections.push(`<li><strong>Society name:</strong> ${normalizedSocietyName}</li>`);
        }

        if (normalizedWingName) {
            htmlSections.push(`<li><strong>Wing name:</strong> ${normalizedWingName}</li>`);
        }

        if (normalizedSocietyPin) {
            htmlSections.push(`<li><strong>Society PIN:</strong> ${normalizedSocietyPin}</li>`);
        }

        if (normalizedNotes) {
            htmlSections.push(`<li><strong>Additional notes:</strong> ${normalizedNotes}</li>`);
        }

        htmlSections.push('</ul>');

        if (authUser) {
            const userName = authUser.fullName || authUser.name || '';
            htmlSections.push('<p>User details:</p>');
            htmlSections.push('<ul>');
            htmlSections.push(`<li><strong>User ID:</strong> ${String(authUser._id)}</li>`);
            if (userName) {
                htmlSections.push(`<li><strong>User name:</strong> ${userName}</li>`);
            }
            htmlSections.push(`<li><strong>Role:</strong> ${authUser.role}</li>`);
            htmlSections.push(
                `<li><strong>Phone:</strong> ${(authUser.countryCode || '').toString()} ${(authUser.phoneNumber || '').toString()}</li>`
            );
            htmlSections.push('</ul>');
        }

        const html = htmlSections.join('');

        // Persist missing unit requests so society admin can view them later.
        // (We keep emailing too, for ops visibility.)
        if (normalizedType === 'unit') {
            let society = null;

            if (normalizedSocietyPin) {
                society = await Society.findOne({ societyPin: normalizedSocietyPin }).lean();
            }

            if (!society && normalizedSocietyName) {
                const cityFilter = normalizedCity ? { city: normalizedCity } : {};
                society = await Society.findOne({ societyName: normalizedSocietyName, ...cityFilter }).lean();
            }

            if (society) {
                const unitNumber = normalizedName;
                const wingLower = normalizedWingName ? normalizedWingName.toLowerCase() : null;
                const unitLower = unitNumber.toLowerCase();

                const requesterPhone = authUser
                    ? `${(authUser.countryCode || '').toString()} ${(authUser.phoneNumber || '').toString()}`.trim()
                    : null;

                const update = {
                    $set: {
                        lastRequestedAt: new Date(),
                        ...(normalizedNotes ? { notes: normalizedNotes } : {}),
                    },
                    $inc: { requestCount: 1 },
                    $addToSet: {
                        ...(authUser?._id ? { requestedByUserIds: authUser._id } : {}),
                        ...(requesterPhone ? { requestedByPhones: requesterPhone } : {}),
                    },
                    $setOnInsert: {
                        societyId: society._id,
                        societyPin: society.societyPin || null,
                        societyName: society.societyName || null,
                        city: society.city || null,
                        country: society.country || null,
                        wingName: normalizedWingName || null,
                        wingNameLower: wingLower,
                        unitNumber,
                        unitNumberLower: unitLower,
                        status: 'pending',
                    },
                };

                await MissingUnitRequest.updateOne(
                    { societyId: society._id, wingNameLower: wingLower, unitNumberLower: unitLower, status: 'pending' },
                    update,
                    { upsert: true }
                );
            }
        }

        await sendSystemAlertEmail({
            subject,
            text,
            html,
        });

        return sendSuccessResponse(res, 202, 'Your request has been recorded. We will notify you once this location is available.', {
            data: null,
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to submit missing location notification'));
    }
};

module.exports = {
    getCountryCityOptions,
    getRegistrationHierarchy,
    notifyMissingLocation,
};
