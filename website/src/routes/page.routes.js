const express = require("express");
const {
  faqs,
  restaurantBenefits,
  riderBenefits,
} = require("../data/site");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("pages/home", {
    title: "Foodbela | ভবিষ্যতের ফুড ডেলিভারি এক্সপেরিয়েন্স",
    description:
      "Foodbela কাস্টমার, রেস্টুরেন্ট এবং রাইডারকে একটি দ্রুত, স্মার্ট এবং লোকাল-ফার্স্ট ফুড ডেলিভারি ইকোসিস্টেমে যুক্ত করে।",
  });
});

router.get("/restaurants", (req, res) => {
  res.render("pages/restaurants", {
    title: "Foodbela for Restaurants | রেস্টুরেন্ট পার্টনারশিপ",
    description:
      "Foodbela-এর সাথে পার্টনার হয়ে আরও অনলাইন অর্ডার নিন, ডেলিভারি ডিমান্ড ম্যানেজ করুন এবং আপনার রেস্টুরেন্ট বড় করুন।",
    benefits: restaurantBenefits,
    faqs: faqs.restaurants,
  });
});

router.get("/download", (req, res) => {
  res.render("pages/download", {
    title: "Download Foodbela App | কাস্টমার অ্যাপ গাইড",
    description:
      "Foodbela customer app Play Store থেকে কীভাবে ডাউনলোড করবেন, অর্ডার করবেন এবং অফার ব্যবহার করবেন তার সহজ গাইড।",
  });
});

router.get("/riders", (req, res) => {
  res.render("pages/riders", {
    title: "Ride with Foodbela | রাইডার অনবোর্ডিং",
    description:
      "Foodbela রাইডার হিসেবে আবেদন করুন এবং আপনার এলাকায় খাবার ডেলিভারি করে আয় করুন।",
    benefits: riderBenefits,
    faqs: faqs.riders,
  });
});

router.get("/about", (req, res) => {
  res.render("pages/about", {
    title: "About Foodbela | আমাদের সম্পর্কে",
    description:
      "Foodbela কাস্টমার, রেস্টুরেন্ট এবং রাইডারদের জন্য একটি লোকাল-ফার্স্ট ফুড ডেলিভারি নেটওয়ার্ক তৈরি করছে।",
  });
});

router.get("/contact", (req, res) => {
  res.render("pages/contact", {
    title: "Contact Foodbela | যোগাযোগ",
    description:
      "কাস্টমার হেল্প, রেস্টুরেন্ট অনবোর্ডিং, রাইডার অনবোর্ডিং এবং পার্টনারশিপ সাপোর্টের জন্য Foodbela টিমের সাথে যোগাযোগ করুন।",
  });
});

module.exports = router;
