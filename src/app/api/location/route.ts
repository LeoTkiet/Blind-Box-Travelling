import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const lat = searchParams.get("lat");
        const lng = searchParams.get("lng");
        const radius = searchParams.get("radius") || "5";

        if (!lat || !lng) {
            return NextResponse.json(
                { error: "Thiếu tham số lat/lng" },
                { status: 400 }
            );
        }

        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        const radiusNum = parseFloat(radius);

        // Get reverse geocoding from Mapbox
        const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const geoResponse = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lngNum},${latNum}.json?language=vi&access_token=${mapboxToken}`
        );
        const geoData = await geoResponse.json();
        const address = geoData.features?.[0]?.place_name || "Vị trí không xác định";

        // Query Supabase for all locations
        const supabase = await createClient();
        const { data: allLocations, error } = await supabase
            .from("locations")
            .select("*")
            .limit(100);

        if (error) {
            console.error("Supabase error:", error);
            return NextResponse.json(
                {
                    address,
                    lat: latNum,
                    lng: lngNum,
                    nearby: [],
                    error: "Không thể tải dữ liệu từ Supabase",
                }
            );
        }

        // Filter locations by distance using Haversine formula
        const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const R = 6371; // Earth's radius in km
            const dLat = ((lat2 - lat1) * Math.PI) / 180;
            const dLon = ((lon2 - lon1) * Math.PI) / 180;
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const nearby = (allLocations || [])
            .map((loc) => ({
                ...loc,
                distance: calculateDistance(latNum, lngNum, loc.latitude, loc.longitude),
            }))
            .filter((loc) => loc.distance <= radiusNum)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 20);

        return NextResponse.json({
            address,
            lat: latNum,
            lng: lngNum,
            nearby,
        });
    } catch (error) {
        console.error("Location API error:", error);
        return NextResponse.json(
            { error: "Không thể lấy thông tin vị trí" },
            { status: 500 }
        );
    }
}
