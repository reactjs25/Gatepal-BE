const { countryCityData } = require('../utils/countryCityData');
const Society = require('../model/societySchema');
const { sendSuccessResponse } = require('../utils/response');

const getCountryCityOptions = async (req, res) => {
    return sendSuccessResponse(res, 200, 'Country and city options fetched successfully', {
        data: countryCityData,
    });
};

const normalizeLabel = (value, fallback = 'Unknown') => {
    if (!value || typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    return trimmed || fallback;
};

const toCityKey = (countryName, cityName) =>
    `${countryName.toLowerCase()}::${cityName.toLowerCase()}`;

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
        const societies = await Society.find({}, 'societyName societyPin country city structure status');

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

        return sendSuccessResponse(res, 200, 'Registration hierarchy fetched successfully', {
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
        error.statusCode = error.statusCode || 500;
        error.publicMessage = error.publicMessage || 'Failed to fetch registration hierarchy';
        next(error);
    }
};

module.exports = {
    getCountryCityOptions,
    getRegistrationHierarchy,
};
