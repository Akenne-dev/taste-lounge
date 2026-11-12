/**
 * Micro-Interactions Module
 * Handles fade-in animations and scroll-triggered effects
 */

// Configuration for Intersection Observer
const observerOptions = {
    root: null,
    rootMargin: "0px 0px -100px 0px",
    threshold: 0.1,
};

// Create Intersection Observer for fade-in animations
const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            // Trigger animation when element enters viewport
            entry.target.classList.add("animate-fade-in");
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

/**
 * Initialize all animations on page load
 */
function initializeMicroInteractions() {
    // Observe sections for fade-in animations
    const sectionsToAnimate = [
        ".about",
        ".foods-section",
        ".unwrapped-section",
        ".parallax",
        "footer",
    ];

    sectionsToAnimate.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
            element.style.opacity = "0";
            element.style.transform = "translateY(30px)";
            observer.observe(element);
        });
    });

    // Observe food cards with staggered animation
    const foodCards = document.querySelectorAll(".food-card");
    foodCards.forEach((card, index) => {
        card.style.opacity = "0";
        card.style.transform = "translateY(30px)";
        // Create individual observers with staggered timing
        setTimeout(() => {
            observer.observe(card);
        }, index * 100);
    });

    // Observe food grid titles
    const foodsTitles = document.querySelectorAll(".foods-title");
    foodsTitles.forEach((title) => {
        title.style.opacity = "0";
        title.style.transform = "translateY(20px)";
        observer.observe(title);
    });

    // Enhance hero content animations
    const heroContent = document.querySelector(".hero-content");
    if (heroContent) {
        heroContent.style.opacity = "0";
        heroContent.style.animation = "fadeInUp 1.2s ease-out 0.5s forwards";
    }
}

/**
 * Add smooth scroll behavior to anchor links
 */
function initializeSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener("click", function (e) {
            const href = this.getAttribute("href");
            if (href !== "#") {
                e.preventDefault();
                const targetElement = document.querySelector(href);
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                    });
                }
            }
        });
    });
}

/**
 * Add scroll reveal animations for elements on scroll
 */
function initializeScrollAnimations() {
    const scrollElements = document.querySelectorAll(".about img, .unwrapped-content");

    const elementInView = (el, dividend = 1) => {
        const elementTop = el.getBoundingClientRect().top;
        return elementTop <= (window.innerHeight || document.documentElement.clientHeight) / dividend;
    };

    const elementOutofView = (el) => {
        const elementTop = el.getBoundingClientRect().top;
        return elementTop > (window.innerHeight || document.documentElement.clientHeight);
    };

    const displayScrollElements = () => {
        scrollElements.forEach((element) => {
            if (elementInView(element, 1.25)) {
                element.classList.add("animate-fade-in");
            } else if (elementOutofView(element)) {
                element.classList.remove("animate-fade-in");
            }
        });
    };

    window.addEventListener("scroll", displayScrollElements);
    displayScrollElements();
}

/**
 * Add button press animation feedback
 */
function initializeButtonAnimations() {
    const buttons = document.querySelectorAll(".btn-order, .btn-about, .food-name, .social-icons .icon");

    buttons.forEach((button) => {
        button.addEventListener("mousedown", function () {
            this.style.transform = "scale(0.96)";
        });

        button.addEventListener("mouseup", function () {
            this.style.transform = "";
        });

        button.addEventListener("mouseleave", function () {
            this.style.transform = "";
        });
    });
}

/**
 * Initialize parallax scroll effect on images
 */
function initializeParallaxEffect() {
    const parallaxElements = document.querySelectorAll(".parallax");

    window.addEventListener("scroll", () => {
        parallaxElements.forEach((element) => {
            const scrollPosition = window.pageYOffset;
            const elementOffset = element.offsetTop;
            const distance = scrollPosition - elementOffset;

            if (Math.abs(distance) < window.innerHeight) {
                element.style.backgroundPosition = `center ${distance * 0.5}px`;
            }
        });
    });
}

/**
 * Add entrance animation to hero video when it's active
 */
function initializeHeroVideoAnimations() {
    const heroVideos = document.querySelectorAll(".hero-video");
    heroVideos.forEach((video) => {
        video.addEventListener("play", function () {
            this.style.animation = "fadeInUp 0.8s ease-out";
        });
    });
}

/**
 * Main initialization function
 */
document.addEventListener("DOMContentLoaded", () => {
    // Initialize all micro-interactions
    initializeMicroInteractions();
    initializeSmoothScroll();
    initializeScrollAnimations();
    initializeButtonAnimations();
    initializeParallaxEffect();
    initializeHeroVideoAnimations();

    // Log initialization (optional - remove in production)
    console.log("✓ Micro-interactions initialized successfully!");
});

/**
 * Re-initialize animations if new content is added dynamically
 */
function reinitializeMicroInteractions() {
    initializeMicroInteractions();
    initializeButtonAnimations();
}
